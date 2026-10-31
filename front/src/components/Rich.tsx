// Texte avec **gras** (noms dans les phrases de l'accueil), sans HTML injecté.
export function Rich({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {text.split("**").map((part, i) => (i % 2 ? <b key={i} className="font-semibold text-txt">{part}</b> : part))}
    </>
  );
}
