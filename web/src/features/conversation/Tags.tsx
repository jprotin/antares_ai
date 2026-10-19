// Mots-clés cliquables (port de tagsHtml, render.js) : 8 au plus, sans doublon ; le clic
// est traité par délégation dans la conversation (data-tag)
export function Tags({ tags }: { tags: string[] }) {
  const unique = [
    ...new Set(tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean)),
  ].slice(0, 8);
  return (
    <div className="tags">
      <span className="tags__label">Mots-clés</span>
      {unique.map((tag) => (
        <button
          key={tag}
          type="button"
          className="tag"
          data-tag={tag}
          title={`Chercher « ${tag} » sur internet`}
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}
