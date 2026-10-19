import { ApiError } from "./http.js";
import { POSITIONS } from "../services/playerFactory.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_MONEY = 1_000_000_000_000;

export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

export function uuid(v, code = "invalid_id") {
  if (!isUuid(v)) throw new ApiError(400, code);
  return v;
}

// Integer in [min, max]. Accepts numbers and numeric strings (query params).
// When the value is missing and `fallback` is given (even null), the fallback is returned.
export function int(v, { min, max, code, fallback }) {
  if ((v === undefined || v === null || v === "") && fallback !== undefined) return fallback;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, code);
  return n;
}

// Optional trimmed text (undefined when missing or not a string)
export function text(v, max = 30) {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t.slice(0, max);
}

export function position(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (!POSITIONS.includes(v)) throw new ApiError(400, "invalid_position");
  return v;
}

export function paging(query) {
  return {
    limit: int(query.limit, { min: 1, max: 50, code: "invalid_limit", fallback: 20 }),
    offset: int(query.offset, { min: 0, max: 100000, code: "invalid_offset", fallback: 0 }),
  };
}

// contract terms shared by buy / sign / release clause / renew (all optional)
export function contractTerms(body) {
  return {
    salary: int(body.weekly_salary, { min: 1, max: 10_000_000, code: "invalid_salary", fallback: null }),
    years: int(body.years, { min: 1, max: 5, code: "invalid_years", fallback: null }),
  };
}
