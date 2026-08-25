import type { StaticQuotes } from './index';

/**
 * Quotes about writing software.
 *
 * Shipped with the worker rather than fetched, deliberately. Every free
 * programming-quote API surveyed while planning this was either returning 429
 * on a single request or gone entirely, and a source that silently stops
 * working is worse here than one that never changes: the widget falls back and
 * nobody finds out. A list in the repository has no failure mode, no latency,
 * and can be edited by anyone who can open a pull request.
 *
 * Attribution is part of the quote, so each entry names who said it.
 */
export const programming: StaticQuotes = {
  en: [
    {
      text: 'There are only two hard things in Computer Science: cache invalidation and naming things.',
      author: 'Phil Karlton',
    },
    {
      text: 'Programs must be written for people to read, and only incidentally for machines to execute.',
      author: 'Harold Abelson',
    },
    {
      text: 'Premature optimization is the root of all evil.',
      author: 'Donald Knuth',
    },
    {
      text: 'Simplicity is prerequisite for reliability.',
      author: 'Edsger W. Dijkstra',
    },
    {
      text: 'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.',
      author: 'Martin Fowler',
    },
    {
      text: 'The most damaging phrase in the language is: we have always done it this way.',
      author: 'Grace Hopper',
    },
    {
      text: 'Deleted code is debugged code.',
      author: 'Jeff Sickel',
    },
    {
      text: 'Make it work, make it right, make it fast.',
      author: 'Kent Beck',
    },
    {
      text: 'Testing shows the presence, not the absence of bugs.',
      author: 'Edsger W. Dijkstra',
    },
    {
      text: 'Controlling complexity is the essence of computer programming.',
      author: 'Brian Kernighan',
    },
    {
      text: 'The function of good software is to make the complex appear simple.',
      author: 'Grady Booch',
    },
    {
      text: 'Weeks of coding can save you hours of planning.',
      author: 'Unknown',
    },
  ],
  hu: [
    {
      text: 'Az informatikában két nehéz dolog van: a gyorsítótár érvénytelenítése és az elnevezés.',
      author: 'Phil Karlton',
    },
    {
      text: 'A programokat embereknek kell írni, és csak mellékesen gépeknek végrehajtásra.',
      author: 'Harold Abelson',
    },
    {
      text: 'A korai optimalizálás minden rossz gyökere.',
      author: 'Donald Knuth',
    },
    {
      text: 'Az egyszerűség a megbízhatóság előfeltétele.',
      author: 'Edsger W. Dijkstra',
    },
    {
      text: 'Olyan kódot bármelyik bolond tud írni, amit a gép megért. A jó programozó olyat ír, amit az ember is.',
      author: 'Martin Fowler',
    },
    {
      text: 'A nyelv legkárosabb mondata: mindig is így csináltuk.',
      author: 'Grace Hopper',
    },
    {
      text: 'A törölt kód hibamentes kód.',
      author: 'Jeff Sickel',
    },
    {
      text: 'Előbb működjön, aztán legyen helyes, végül legyen gyors.',
      author: 'Kent Beck',
    },
    {
      text: 'A tesztelés a hibák jelenlétét mutatja ki, nem a hiányukat.',
      author: 'Edsger W. Dijkstra',
    },
    {
      text: 'A komplexitás kordában tartása a programozás lényege.',
      author: 'Brian Kernighan',
    },
    {
      text: 'A jó szoftver dolga, hogy a bonyolultat egyszerűnek mutassa.',
      author: 'Grady Booch',
    },
    {
      text: 'Hetekig tartó kódolással órákat spórolhatsz a tervezésen.',
      author: 'Ismeretlen',
    },
  ],
};
