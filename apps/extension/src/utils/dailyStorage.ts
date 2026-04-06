interface CachePacket<T> {
  date: string; // "YYYY-MM-DD"
  query?: string;
  data: T;
}

export const getTodayData = <T>(key: string): T | null => {
  const json = localStorage.getItem(key);
  if (!json) return null;
  try {
    const packet: CachePacket<T> = JSON.parse(json);
    const today = new Date().toISOString().split('T')[0];
    if (packet.date !== today) return null;
    return packet.data;
  } catch {
    return null;
  }
};

export const getDailyData = <T>(key: string, currentQuery?: string): T | null => {
  const json = localStorage.getItem(key);
  if (!json) return null;

  try {
    const packet: CachePacket<T> = JSON.parse(json);
    const today = new Date().toISOString().split('T')[0];

    if (packet.date !== today || packet.query !== currentQuery) {
      return null;
    }
    return packet.data;
  } catch {
    return null;
  }
};

export const setDailyData = <T>(key: string, data: T, query?: string) => {
  const today = new Date().toISOString().split('T')[0];
  const packet: CachePacket<T> = {
    date: today,
    query,
    data,
  };
  localStorage.setItem(key, JSON.stringify(packet));
};
