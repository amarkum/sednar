const fields = ["bill", "tip", "people"].map((id) => document.getElementById(id));

function money(value) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function update() {
  const bill = Number(fields[0].value) || 0;
  const tipPercent = Number(fields[1].value) || 0;
  const people = Math.max(1, Math.floor(Number(fields[2].value) || 1));

  const tip = bill * tipPercent;
  const total = bill + tip;
  const each = Math.round(total / people);

  document.getElementById("tip-amount").textContent = money(tip);
  document.getElementById("total").textContent = money(total);
  document.getElementById("each").textContent = money(each);
}

fields.forEach((field) => field.addEventListener("input", update));
update();
