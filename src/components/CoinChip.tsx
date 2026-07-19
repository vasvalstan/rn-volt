import { Text, View, StyleSheet, type TextStyle, type ViewStyle } from "react-native";

const C = {
  black: "#1A1A1A",
  white: "#FFFFFF",
  chipBg: "#FEB584",
  hotPink: "#FF2D78",
};

const SH2 = {
  shadowColor: C.black,
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 2,
} as const;

type CoinIconProps = {
  readonly size?: number;
};

export function CoinIcon({ size = 24 }: CoinIconProps) {
  const wrapperSize = size;
  const emojiSize = Math.round(size * 0.72);

  return (
    <View
      style={[
        s.iconWrap,
        {
          width: wrapperSize,
          height: wrapperSize,
          borderRadius: wrapperSize / 2,
        },
      ]}
    >
      <Text style={[s.iconText, { fontSize: emojiSize, lineHeight: wrapperSize - 2 }]}>
        🪙
      </Text>
    </View>
  );
}

type CoinChipProps = {
  readonly amount: number | string;
  readonly style?: ViewStyle;
  readonly textStyle?: TextStyle;
  readonly iconSize?: number;
};

export function CoinChip({ amount, style, textStyle, iconSize = 24 }: CoinChipProps) {
  return (
    <View style={[s.chip, style]}>
      <CoinIcon size={iconSize} />
      <Text style={[s.chipText, textStyle]}>{amount}</Text>
    </View>
  );
}

type CoinPricePillProps = {
  readonly amount: number | string;
  readonly tone?: "light" | "dark";
  readonly style?: ViewStyle;
};

export function CoinPricePill({
  amount,
  tone = "dark",
  style,
}: CoinPricePillProps) {
  const isDark = tone === "dark";

  return (
    <View
      style={[
        s.pricePill,
        isDark ? s.pricePillDark : s.pricePillLight,
        style,
      ]}
    >
      <CoinIcon size={18} />
      <Text style={[s.priceText, isDark ? s.priceTextDark : s.priceTextLight]}>
        {amount}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.black,
  },
  iconText: {
    color: C.black,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 4,
    backgroundColor: C.chipBg,
    borderWidth: 2,
    borderColor: C.black,
    borderRadius: 999,
    ...SH2,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 24,
    fontWeight: "900",
    color: C.black,
    letterSpacing: 0,
  },
  pricePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 4,
  },
  pricePillDark: {
    backgroundColor: C.hotPink,
    borderColor: C.black,
  },
  pricePillLight: {
    backgroundColor: "#FFF1E7",
    borderColor: C.black,
  },
  priceText: {
    fontSize: 11,
    fontWeight: "900",
  },
  priceTextDark: {
    color: C.white,
  },
  priceTextLight: {
    color: C.hotPink,
  },
});
