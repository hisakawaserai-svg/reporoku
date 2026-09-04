import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { OSS_LICENSES, type OssLicenseEntry } from "../licenses/ossLicenses";
import { radius, spacing } from "../theme/spacing";
import { fontSize } from "../theme/typography";

/**
 * package.json の直接依存の OSS ライセンス一覧。
 * 本文は react-native-oss-license (MIT) で生成した JSON を表示する。
 */
export default function OpenSourceLicensesScreen() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = useCallback((name: string) => {
    setExpanded((prev) => (prev === name ? null : name));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: OssLicenseEntry }) => {
      const isOpen = expanded === item.libraryName;
      return (
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => toggle(item.libraryName)}
          >
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.libraryName}</Text>
              <Text style={styles.meta}>
                {[item._license, item.version ? `v${item.version}` : null].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Ionicons
              name={isOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color="#8e8e93"
            />
          </TouchableOpacity>
          {isOpen ? (
            <View style={styles.detail}>
              {item._description ? (
                <Text style={styles.description}>{item._description}</Text>
              ) : null}
              <Text style={styles.licenseBody}>
                {item._licenseContent?.trim() || item._license || "—"}
              </Text>
            </View>
          ) : null}
        </View>
      );
    },
    [expanded, toggle]
  );

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <FlatList
        data={OSS_LICENSES}
        keyExtractor={(item) => item.libraryName}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },
  list: { padding: spacing.screenPadding, paddingBottom: 32, gap: 10 },
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.cardTitle, fontWeight: "600", color: "#1c1c1e" },
  meta: { fontSize: 13, color: "#8e8e93", marginTop: 2 },
  detail: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5ea",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  description: { fontSize: 13, color: "#636366", lineHeight: 18 },
  licenseBody: {
    fontSize: 12,
    color: "#3c3c43",
    lineHeight: 18,
    fontFamily: "Courier",
  },
});
