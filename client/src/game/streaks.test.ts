import { describe, expect, it } from "vitest";
import { loadStreak, recordPlaySession, type StreakRecord } from "./streaks";
import { todayKey } from "./daily";

function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("streaks", () => {
  it("starts empty when nothing was ever saved", () => {
    expect(loadStreak(fakeStorage())).toEqual<StreakRecord>({
      currentStreak: 0,
      longestStreak: 0,
      lastPlayedDay: "",
    });
  });

  it("starts a streak of 1 on the first session", () => {
    const storage = fakeStorage();
    const { record, isFirstToday } = recordPlaySession(storage, "2026-03-05");
    expect(isFirstToday).toBe(true);
    expect(record).toEqual<StreakRecord>({ currentStreak: 1, longestStreak: 1, lastPlayedDay: "2026-03-05" });
  });

  it("does not increment on a second session the same day", () => {
    const storage = fakeStorage();
    recordPlaySession(storage, "2026-03-05");
    const { record, isFirstToday } = recordPlaySession(storage, "2026-03-05");
    expect(isFirstToday).toBe(false);
    expect(record.currentStreak).toBe(1);
  });

  it("increments when the next session is the following calendar day", () => {
    const storage = fakeStorage();
    recordPlaySession(storage, "2026-03-05");
    const { record } = recordPlaySession(storage, "2026-03-06");
    expect(record.currentStreak).toBe(2);
    expect(record.longestStreak).toBe(2);
  });

  it("increments correctly across a month boundary", () => {
    const storage = fakeStorage();
    recordPlaySession(storage, "2026-02-28");
    const { record } = recordPlaySession(storage, "2026-03-01");
    expect(record.currentStreak).toBe(2);
  });

  it("resets to 1 when a day is skipped", () => {
    const storage = fakeStorage();
    recordPlaySession(storage, "2026-03-05");
    recordPlaySession(storage, "2026-03-06");
    const { record } = recordPlaySession(storage, "2026-03-08");
    expect(record.currentStreak).toBe(1);
  });

  it("keeps the longest streak on record even after a reset", () => {
    const storage = fakeStorage();
    recordPlaySession(storage, "2026-03-01");
    recordPlaySession(storage, "2026-03-02");
    recordPlaySession(storage, "2026-03-03");
    const { record } = recordPlaySession(storage, "2026-03-10");
    expect(record.currentStreak).toBe(1);
    expect(record.longestStreak).toBe(3);
  });

  it("defaults `today` to the real current date", () => {
    const storage = fakeStorage();
    const { record } = recordPlaySession(storage);
    expect(record.lastPlayedDay).toBe(todayKey());
  });
});
