import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

export const STORE_CATALOG = [
  {
    itemId: "skin_default",
    category: "skin",
    name: "Classic Volt",
    description: "The original green Volt mascot.",
    price: 0,
    isGiftable: false,
    isSelfPurchasable: false,
  },
  {
    itemId: "skin_flame",
    category: "skin",
    name: "Flame Volt",
    description: "Red-hot energy. For the relentless grinder.",
    price: 200,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "skin_ice",
    category: "skin",
    name: "Ice Volt",
    description: "Cool, calm, and in control.",
    price: 200,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "skin_shadow",
    category: "skin",
    name: "Shadow Volt",
    description: "Dark mode energy. Stealthy discipline.",
    price: 200,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "skin_gold",
    category: "skin",
    name: "Gold Volt",
    description: "Flex your dedication. You earned it.",
    price: 500,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "skin_rainbow",
    category: "skin",
    name: "Rainbow Volt",
    description: "The rarest Volt. A true legend.",
    price: 200,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "lazy_pass",
    category: "freeze",
    name: "Lazy Pass",
    description: "Gift a streak freeze to a friend. Cannot buy for yourself.",
    price: 150,
    isGiftable: true,
    isSelfPurchasable: false,
  },
  {
    itemId: "shield_dark",
    category: "shield_theme",
    name: "Dark Mode Shield",
    description: "A sleek dark blocking screen.",
    price: 300,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "shield_neon",
    category: "shield_theme",
    name: "Neon Shield",
    description: "Electric neon glow on your shield.",
    price: 300,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "shield_minimal",
    category: "shield_theme",
    name: "Minimal Shield",
    description: "Clean and simple blocking screen.",
    price: 150,
    isGiftable: true,
    isSelfPurchasable: true,
  },
  {
    itemId: "vp_bundle",
    category: "vp",
    name: "VP Bundle 50",
    description: "Gift 50 VP to a friend.",
    price: 150,
    isGiftable: true,
    isSelfPurchasable: false,
  },
  {
    itemId: "vp_bundle_100",
    category: "vp",
    name: "VP Bundle 100",
    description: "Gift 100 VP to a friend.",
    price: 280,
    isGiftable: true,
    isSelfPurchasable: false,
  },
  {
    itemId: "good_habit_msg",
    category: "social",
    name: "Good Habit Card",
    description: "Send an encouraging message to a friend.",
    price: 5,
    isGiftable: true,
    isSelfPurchasable: false,
  },
] as const;

function findCatalogItem(itemId: string) {
  return STORE_CATALOG.find((i) => i.itemId === itemId);
}

export const getStoreItems = query({
  args: {},
  handler: async () => {
    return STORE_CATALOG.filter((i) => i.price > 0);
  },
});

export const getOwnedItems = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("ownedItems")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const purchaseItem = mutation({
  args: {
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const item = findCatalogItem(args.itemId);
    if (!item) throw new Error("Item not found");
    if (!item.isSelfPurchasable)
      throw new Error("This item cannot be purchased for yourself");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");

    if ((profile.coinBalance ?? 0) < item.price)
      throw new Error("Not enough coins");

    const alreadyOwned = await ctx.db
      .query("ownedItems")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect()
      .then((items) => items.some((o) => o.itemId === args.itemId));

    if (alreadyOwned && (item.category as string) !== "freeze")
      throw new Error("You already own this item");

    await ctx.db.patch(profile._id, {
      coinBalance: (profile.coinBalance ?? 0) - item.price,
    });

    await ctx.db.insert("ownedItems", {
      userId,
      itemId: args.itemId,
      acquiredAt: Date.now(),
      source: "purchase",
    });

    if (item.category === "skin") {
      await ctx.db.patch(profile._id, { equippedSkin: args.itemId });
    } else if (item.category === "shield_theme") {
      await ctx.db.patch(profile._id, { equippedShieldTheme: args.itemId });
    }

    return { success: true };
  },
});

export const equipItem = mutation({
  args: {
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const item = findCatalogItem(args.itemId);
    if (!item) throw new Error("Item not found");

    if (args.itemId !== "skin_default") {
      const owned = await ctx.db
        .query("ownedItems")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect()
        .then((items) => items.some((o) => o.itemId === args.itemId));

      if (!owned) throw new Error("You don't own this item");
    }

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");

    if (item.category === "skin") {
      await ctx.db.patch(profile._id, { equippedSkin: args.itemId });
    } else if (item.category === "shield_theme") {
      await ctx.db.patch(profile._id, { equippedShieldTheme: args.itemId });
    }

    return { success: true };
  },
});

// ─── COIN → FUEL EXCHANGE ──────────────────────────────
export const FUEL_EXCHANGE_RATES = [
  { id: "fuel_5", minutes: 5, price: 300, label: "5 extra minutes" },
  { id: "fuel_10", minutes: 10, price: 300, label: "10 extra minutes" },
] as const;

export const getFuelExchangeRates = query({
  args: {},
  handler: async () => FUEL_EXCHANGE_RATES,
});

export const exchangeCoinsForFuel = mutation({
  args: {
    rateId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const rate = FUEL_EXCHANGE_RATES.find((r) => r.id === args.rateId);
    if (!rate) throw new Error("Invalid exchange rate");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");

    if ((profile.coinBalance ?? 0) < rate.price)
      throw new Error(`Not enough coins. You need ${rate.price} coins.`);

    const today = new Date().toISOString().split("T")[0];
    if (rate.id === "fuel_5" && profile.lastFuel5PurchaseDate === today)
      throw new Error("You already bought the 5-minute boost today");
    if (rate.id === "fuel_10" && profile.lastFuel10PurchaseDate === today)
      throw new Error("You already bought the 10-minute boost today");

    await ctx.db.patch(profile._id, {
      coinBalance: (profile.coinBalance ?? 0) - rate.price,
      minutesAvailable: profile.minutesAvailable + rate.minutes,
      ...(rate.id === "fuel_5"
        ? { lastFuel5PurchaseDate: today }
        : { lastFuel10PurchaseDate: today }),
    });

    return { success: true, minutesAdded: rate.minutes };
  },
});
