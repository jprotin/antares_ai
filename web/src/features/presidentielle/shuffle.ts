// Tirage au sort de l'ordre des candidats (neutralité) : Fisher-Yates sur une copie,
// générateur injectable (entier de 32 bits). En production, crypto.getRandomValues ;
// jamais Math.random.

// Générateur : entier entre 0 et 2³²−1
export type Rng = () => number;

const RANGE = 2 ** 32;

export function cryptoRng(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

// Indice entre 0 et size−1 : 0 et 2³²−1 restent dans l'intervalle (écart au tirage
// uniforme inférieur à size / 2³², négligeable pour quelques dizaines de candidats)
export function indexBelow(size: number, rng: Rng): number {
  const value = Math.min(Math.max(Math.floor(rng()), 0), RANGE - 1);
  return Math.floor((value / RANGE) * size);
}

export function shuffle<T>(items: readonly T[], rng: Rng = cryptoRng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = indexBelow(i + 1, rng);
    const current = result[i] as T;
    result[i] = result[j] as T;
    result[j] = current;
  }
  return result;
}
