import { useTopSites } from '../hooks/useTopSites';

export const TopSitesWidget = () => {
  const sites = useTopSites();

  if (!sites.length) return null;

  return (
    // Pozicionálás: Alul, középen, fixen. Z-index, hogy a háttér fölött legyen.
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">

      {/* A "Dock" konténer */}
      <div className="flex items-center gap-4 px-6 py-3 bg-black/20 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">

        {sites.map((site) => (
          <a
            key={site.url}
            href={site.url}
            title={site.title}
            className="group relative flex flex-col items-center justify-center transition-transform active:scale-95"
          >
            {/* Ikon konténer háttérrel, hogy sötét/világos ikon is látszódjon */}
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/5 group-hover:bg-white/20 transition-colors">
                <img
                // Google S2 Favicon service: sz=64 a méret (64px)
                src={`https://www.google.com/s2/favicons?domain=${site.url}&sz=64`}
                alt={site.title}
                className="w-8 h-8 drop-shadow-md opacity-90 group-hover:opacity-100 transition-opacity"
                loading="lazy"
                />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
};
