// Bouton Copier des blocs de code (port de enableCodeCopy, render.js)

// Secours si l'API presse-papiers est refusée (permissions, contexte non sécurisé)
function copyWithSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

export async function copyCode(button: HTMLElement) {
  const code = button.closest(".code")?.querySelector("code")?.innerText ?? "";
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = "Copié";
  } catch {
    button.textContent = copyWithSelection(code) ? "Copié" : "Copie impossible";
  }
  window.setTimeout(() => (button.textContent = "Copier"), 1500);
}
