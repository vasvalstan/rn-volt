/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities from "../activities.js";
import type * as auth from "../auth.js";
import type * as cron_functions from "../cron_functions.js";
import type * as crons from "../crons.js";
import type * as fuelMetrics from "../fuelMetrics.js";
import type * as fuelRollups from "../fuelRollups.js";
import type * as gifts from "../gifts.js";
import type * as http from "../http.js";
import type * as leaderboard from "../leaderboard.js";
import type * as leaderboardUtils from "../leaderboardUtils.js";
import type * as openai from "../openai.js";
import type * as sessions from "../sessions.js";
import type * as social from "../social.js";
import type * as store from "../store.js";
import type * as streaks from "../streaks.js";
import type * as training from "../training.js";
import type * as users from "../users.js";
import type * as voiceUsage from "../voiceUsage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activities: typeof activities;
  auth: typeof auth;
  cron_functions: typeof cron_functions;
  crons: typeof crons;
  fuelMetrics: typeof fuelMetrics;
  fuelRollups: typeof fuelRollups;
  gifts: typeof gifts;
  http: typeof http;
  leaderboard: typeof leaderboard;
  leaderboardUtils: typeof leaderboardUtils;
  openai: typeof openai;
  sessions: typeof sessions;
  social: typeof social;
  store: typeof store;
  streaks: typeof streaks;
  training: typeof training;
  users: typeof users;
  voiceUsage: typeof voiceUsage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
