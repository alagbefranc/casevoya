"use client";

/**
 * The header's section crumb ("Leads ▾", "Calendar ▾", "Practice ▾"…): pressing it opens a small
 * menu of that section's pages, taken from the sidebar's own group, so the two never disagree.
 * One script for every Sheet page; no page's markup changes. The menu reuses the Designer's
 * select-menu classes (`.k2-gs-m`, `.k2-gs-l`), the same ones the Pipeline's Stage filter uses.
 */

const SPRITE = "/assets/icons-coreui/sprite.svg";

export type CrumbLink = { label: string; href: string; current: boolean };

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The pages a crumb stands for: the sidebar group named like the crumb ("Leads", "Practice");
 * otherwise the group holding the page the crumb names ("Calendar" is in Leads, "Team queue" in
 * Boards); otherwise the group of the page that is open; otherwise the sidebar's top links.
 */
export type CrumbGroup = { name: string; links: CrumbLink[] };

/** The choice itself, on plain data (see crumbLinks). */
export function chooseCrumbLinks(groups: readonly CrumbGroup[], top: readonly CrumbLink[], crumbLabel: string): CrumbLink[] {
  const label = crumbLabel.trim().toLowerCase();
  const byName = groups.find((group) => group.name.toLowerCase() === label);
  const byPage = groups.find((group) => group.links.some((link) => link.label.toLowerCase() === label));
  const byCurrent = groups.find((group) => group.links.some((link) => link.current));
  return (byName ?? byPage ?? byCurrent)?.links ?? [...top];
}

export function crumbLinks(side: ParentNode | null, crumbLabel: string): CrumbLink[] {
  if (!side) return [];
  const links = (scope: ParentNode, selector: string) =>
    [...scope.querySelectorAll<HTMLAnchorElement>(selector)]
      .filter((link) => !link.classList.contains("add") && link.getAttribute("href") && link.getAttribute("href") !== "#")
      .map((link) => ({ label: text(link.querySelector("span")) || text(link), href: link.getAttribute("href") ?? "", current: link.classList.contains("on") }));
  const groups = [...side.querySelectorAll<HTMLElement>(".grp")].map((group) => ({ name: text(group.querySelector(":scope > button span")), links: links(group, ".tree a") }));
  return chooseCrumbLinks(groups, links(side, ".nav a"), crumbLabel);
}

export function closeCrumbMenu(root: ParentNode) {
  root.querySelectorAll(".k2-crumb-m").forEach((menu) => menu.remove());
  root.querySelectorAll('header.top .crumb[aria-expanded="true"]').forEach((crumb) => crumb.setAttribute("aria-expanded", "false"));
}

export function toggleCrumbMenu(root: HTMLElement, crumb: HTMLElement, go: (href: string) => void) {
  const open = crumb.getAttribute("aria-expanded") === "true";
  closeCrumbMenu(root);
  if (open) return;
  const items = crumbLinks(root.querySelector("#side"), text(crumb));
  if (!items.length) return;
  const box = crumb.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "k2-gs-m k2-crumb-m";
  menu.dataset.state = "closed";
  Object.assign(menu.style, { position: "fixed", top: `${Math.round(box.bottom + 6)}px`, left: `${Math.round(box.left)}px` });
  const list = document.createElement("ul");
  list.className = "k2-gs-l";
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", text(crumb));
  for (const item of items) {
    const li = document.createElement("li");
    li.setAttribute("role", "menuitem");
    li.tabIndex = -1;
    li.dataset.href = item.href;
    if (item.current) li.setAttribute("aria-selected", "true");
    const label = document.createElement("span");
    label.textContent = item.label;
    li.append(label);
    li.insertAdjacentHTML("beforeend", `<svg class="ic s k2-gs-ck" aria-hidden="true"><use href="${SPRITE}#i-check-circle" /></svg>`);
    li.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeCrumbMenu(root);
      if (!item.current) go(item.href);
    });
    li.addEventListener("keydown", (event) => {
      const all = [...list.querySelectorAll<HTMLElement>("li")];
      const at = all.indexOf(li);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        all[(at + (event.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        li.click();
      } else if (event.key === "Escape") {
        closeCrumbMenu(root);
        crumb.focus();
      }
    });
    list.append(li);
  }
  menu.append(list);
  root.append(menu);
  crumb.setAttribute("aria-haspopup", "menu");
  crumb.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    menu.dataset.state = "open";
    (list.querySelector<HTMLElement>('li[aria-selected="true"]') ?? list.querySelector<HTMLElement>("li"))?.focus();
  });
}
