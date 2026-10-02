#!/usr/bin/env bash
# Run in Oracle Cloud Shell. Creates the network for Sednar once, then keeps asking for a free Ampere
# server (2 OCPUs / 12 GB, or 1 / 6) every minute until Oracle has capacity. Free Tier capacity comes and
# goes, and "Out of capacity" is Oracle's answer when there is none right now.
# Needs ~/sednar.pub (the SSH public key). Log: ~/sednar-launch.log
set -uo pipefail
C="$OCI_TENANCY"
AD=$(oci iam availability-domain list -c "$C" --query 'data[0].name' --raw-output)

VCN=$(oci network vcn list -c "$C" --display-name sednar-vcn --query 'data[0].id' --raw-output 2>/dev/null)
if [ -z "$VCN" ] || [ "$VCN" = "None" ]; then
  VCN=$(oci network vcn create -c "$C" --cidr-blocks '["10.0.0.0/16"]' --display-name sednar-vcn --dns-label sednar \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi
IGW=$(oci network internet-gateway list -c "$C" --vcn-id "$VCN" --query 'data[0].id' --raw-output 2>/dev/null)
if [ -z "$IGW" ] || [ "$IGW" = "None" ]; then
  IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true --display-name sednar-igw \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi
RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
oci network route-table update --rt-id "$RT" --force \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
# SSH, HTTP and HTTPS from anywhere, plus the ICMP rules Oracle's default list has.
SL=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
oci network security-list update --security-list-id "$SL" --force --ingress-security-rules '[
  {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
  {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
  {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
  {"protocol":"17","source":"0.0.0.0/0","udpOptions":{"destinationPortRange":{"min":443,"max":443}}},
  {"protocol":"1","source":"0.0.0.0/0","icmpOptions":{"type":3,"code":4}},
  {"protocol":"1","source":"10.0.0.0/16","icmpOptions":{"type":3}}]' >/dev/null
SUBNET=$(oci network subnet list -c "$C" --vcn-id "$VCN" --query 'data[0].id' --raw-output 2>/dev/null)
if [ -z "$SUBNET" ] || [ "$SUBNET" = "None" ]; then
  SUBNET=$(oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name sednar-subnet \
    --dns-label web --route-table-id "$RT" --security-list-ids "[\"$SL\"]" --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi
IMG=$(oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC --limit 1 --query 'data[0].id' --raw-output)
echo "$(date) ready: AD=$AD subnet=$SUBNET image=$IMG"

n=0
while true; do
  for cfg in '{"ocpus":2,"memoryInGBs":12}' '{"ocpus":1,"memoryInGBs":6}'; do
    n=$((n + 1))
    if oci compute instance launch -c "$C" --availability-domain "$AD" --shape VM.Standard.A1.Flex --shape-config "$cfg" \
        --image-id "$IMG" --subnet-id "$SUBNET" --assign-public-ip true --display-name sednar --hostname-label sednar \
        --boot-volume-size-in-gbs 100 --ssh-authorized-keys-file ~/sednar.pub \
        --query 'data.id' --raw-output > ~/sednar-instance.txt 2> ~/sednar-last-error.txt; then
      echo "$(date) attempt $n: got a server ($cfg): $(cat ~/sednar-instance.txt)"
      exit 0
    fi
    echo "$(date) attempt $n ($cfg): $(grep -o '"message": "[^"]*' ~/sednar-last-error.txt | head -1 | cut -c13-90)"
  done
  sleep 60
done
