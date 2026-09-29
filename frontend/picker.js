// Liste déroulante soignée (agent, mode) : groupes, pastille de couleur, recherche
// optionnelle, navigation au clavier ; se ferme au clic extérieur ou avec Échap.

let openPicker = null;

document.addEventListener("pointerdown", (event) => {
  if (openPicker && !openPicker.root.contains(event.target)) openPicker.close();
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalize(text) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// groups : [{ label, items: [{ value, label, detail, hue }] }]
export function createPicker({ root, label, searchable = false, onSelect }) {
  root.classList.add("picker");
  const button = element("button", "picker__button");
  button.type = "button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const dot = element("span", "picker__dot");
  const text = element("span", "picker__text");
  const caption = element("span", "picker__label", label);
  const value = element("span", "picker__value");
  text.append(caption, value);
  const chevron = element("span", "picker__chevron");
  chevron.setAttribute("aria-hidden", "true");
  button.append(dot, text, chevron);

  const panel = element("div", "picker__panel");
  panel.hidden = true;
  const search = element("input", "picker__search");
  search.type = "search";
  search.placeholder = "Rechercher…";
  search.setAttribute("aria-label", `Rechercher : ${label}`);
  const list = element("ul", "picker__list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  if (searchable) panel.append(search);
  panel.append(list);
  root.replaceChildren(button, panel);

  let groups = [];
  let selected = "";
  let options = [];
  let active = -1;

  function setActive(index) {
    options.forEach((option, i) =>
      option.classList.toggle("is-active", i === index),
    );
    active = index;
    options[index]?.scrollIntoView({ block: "nearest" });
  }

  function renderList() {
    const query = normalize(search.value.trim());
    list.replaceChildren();
    options = [];
    for (const group of groups) {
      const items = group.items.filter(
        (item) =>
          !query ||
          normalize(
            `${item.label} ${item.detail ?? ""} ${group.label ?? ""}`,
          ).includes(query),
      );
      if (!items.length) continue;
      if (group.label) {
        const heading = element("li", "picker__group", group.label);
        heading.setAttribute("role", "presentation");
        list.append(heading);
      }
      for (const item of items) {
        const option = element("li", "picker__option");
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(item.value === selected));
        option.style.setProperty("--item-hue", item.hue);
        const itemDot = element("span", "picker__dot");
        const body = element("span", "picker__text");
        body.append(element("span", "picker__name", item.label));
        if (item.detail)
          body.append(element("span", "picker__detail", item.detail));
        option.append(itemDot, body);
        option.addEventListener("click", () => choose(item));
        option.addEventListener("pointermove", () =>
          setActive(options.indexOf(option)),
        );
        option.item = item;
        list.append(option);
        options.push(option);
      }
    }
    if (!options.length)
      list.append(element("li", "picker__empty", "Aucun résultat"));
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.item.value === selected),
      ),
    );
  }

  function open() {
    openPicker?.close();
    openPicker = api;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    search.value = "";
    renderList();
    (searchable ? search : list).focus();
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (openPicker === api) openPicker = null;
  }

  function choose(item) {
    close();
    button.focus();
    if (item.value !== selected) onSelect(item.value);
  }

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  search.addEventListener("input", renderList);
  list.tabIndex = -1;
  panel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(options.length - 1, active + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (event.key === "Enter" && options[active]) {
      event.preventDefault();
      choose(options[active].item);
    } else if (event.key === "Escape") {
      close();
      button.focus();
    }
  });

  const api = {
    root,
    close,
    update(nextGroups, nextSelected) {
      groups = nextGroups;
      selected = nextSelected;
      const current = groups
        .flatMap((group) => group.items)
        .find((item) => item.value === selected);
      value.textContent = current?.label ?? "—";
      root.style.setProperty("--item-hue", current?.hue ?? "var(--hue)");
      if (!panel.hidden) renderList();
    },
  };
  return api;
}
