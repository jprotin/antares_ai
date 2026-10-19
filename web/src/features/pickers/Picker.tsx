// Liste déroulante soignée (port de picker.js) : groupes, pastille de couleur, recherche
// optionnelle, clavier ; Popover non modal (Radix) et liste cmdk.
import { Command } from "cmdk";
import { Popover } from "radix-ui";
import { useState, type CSSProperties } from "react";

import { filter } from "./filter";

export type PickerItem = {
  value: string;
  label: string;
  detail?: string;
  hue?: number;
};
export type PickerGroup = { label?: string; items: PickerItem[] };

type Props = {
  label: string;
  groups: PickerGroup[];
  selected: string;
  searchable?: boolean;
  onSelect(value: string): void;
};

export function Picker({
  label,
  groups,
  selected,
  searchable = false,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const current = groups
    .flatMap((g) => g.items)
    .find((i) => i.value === selected);
  // Option active à l'ouverture : le choix courant, comme l'ancienne interface
  const currentGroup = groups.find((g) =>
    g.items.some((i) => i.value === selected),
  );
  const currentKey = `${currentGroup?.label ?? ""}:${selected}`;
  const rootStyle = {
    "--item-hue": current?.hue ?? "var(--hue)",
  } as CSSProperties;

  // Radix rend le focus au bouton à la fermeture (choix, Échap, clic extérieur)
  function choose(item: PickerItem) {
    setOpen(false);
    if (item.value !== selected) onSelect(item.value);
  }

  return (
    <div className="picker" style={rootStyle}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="picker__button"
            aria-haspopup="listbox"
          >
            <span className="picker__dot" />
            <span className="picker__text">
              <span className="picker__label">{label}</span>
              <span className="picker__value">{current?.label ?? "—"}</span>
            </span>
            <span className="picker__chevron" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="picker__panel"
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(event) => {
              // Focus dans cmdk (recherche, sinon la liste) : flèches et Entrée actives
              event.preventDefault();
              (event.currentTarget as HTMLElement)
                .querySelector<HTMLElement>("[cmdk-input], [cmdk-root]")
                ?.focus();
            }}
          >
            <Command
              label={label}
              filter={filter}
              loop={false}
              tabIndex={-1}
              defaultValue={currentKey}
            >
              {searchable && (
                <Command.Input
                  className="picker__search"
                  placeholder="Rechercher…"
                  aria-label={`Rechercher : ${label}`}
                />
              )}
              <Command.List className="picker__list" aria-label={label}>
                <Command.Empty className="picker__empty">
                  Aucun résultat
                </Command.Empty>
                {groups.map((group, index) => (
                  <Command.Group
                    key={group.label ?? `groupe-${index}`}
                    heading={group.label}
                    className="picker__group-block"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={`${group.label ?? ""}:${item.value}`}
                        value={`${group.label ?? ""}:${item.value}`}
                        keywords={[
                          item.label,
                          item.detail ?? "",
                          group.label ?? "",
                        ]}
                        className="picker__option"
                        data-current={item.value === selected}
                        style={{ "--item-hue": item.hue } as CSSProperties}
                        onSelect={() => choose(item)}
                      >
                        <span className="picker__dot" />
                        <span className="picker__text">
                          <span className="picker__name">{item.label}</span>
                          {item.detail && (
                            <span className="picker__detail">
                              {item.detail}
                            </span>
                          )}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
