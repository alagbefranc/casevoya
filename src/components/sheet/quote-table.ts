/** Add a row (from the table's `<template>`) or remove one, inside the Edit quote dialog. */
export function editQuoteTable(target: HTMLElement): boolean {
  const add = target.closest<HTMLElement>("[data-quote-add]");
  if (add?.dataset.quoteAdd) {
    const table = document.getElementById(add.dataset.quoteAdd);
    const template = document.getElementById(add.dataset.quoteAdd === "qeLines" ? "qeLineRow" : "qeInstRow") as HTMLTemplateElement | null;
    const body = table?.querySelector("tbody");
    if (body && template) body.appendChild(template.content.cloneNode(true));
    return true;
  }
  const remove = target.closest<HTMLElement>("[data-quote-remove]");
  if (remove) {
    remove.closest("tr")?.remove();
    return true;
  }
  return false;
}
