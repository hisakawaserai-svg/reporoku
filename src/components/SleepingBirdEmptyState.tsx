import { StyleSheet, Text, View } from "react-native";

import BirdMascot from "./BirdMascot";

type Props = {
  title: string;
  hint: string;
};

/** ノート空状態用。眠っているシマエナガ＋2行メッセージ。 */
export default function SleepingBirdEmptyState({ title, hint }: Props) {
  return (
    <View style={styles.wrap}>
      <BirdMascot variant="sleep" size={140} showScene={false} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 8,
  },
  title: { color: "#8e8e93", fontSize: 14, textAlign: "center" },
  hint: { color: "#aeaeb2", fontSize: 13, textAlign: "center" },
});
