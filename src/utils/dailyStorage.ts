// src/utils/dailyStorage.ts

interface CachePacket<T> {
  date: string; // "YYYY-MM-DD"
  data: T;
}

export const getDailyData = <T>(key: string): T | null => {
  const json = localStorage.getItem(key);
  if (!json) return null;

  try {
    const packet: CachePacket<T> = JSON.parse(json);
    const today = new Date().toISOString().split('T')[0];

    // Ha a mentett dátum nem a mai, akkor érvénytelen (null)
    if (packet.date !== today) {
      return null;
    }
    return packet.data;
  } catch {
    return null;
  }
};

export const setDailyData = <T>(key: string, data: T) => {
  const today = new Date().toISOString().split('T')[0];
  const packet: CachePacket<T> = {
    date: today,
    data,
  };
  localStorage.setItem(key, JSON.stringify(packet));
};
