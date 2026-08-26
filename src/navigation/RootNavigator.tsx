import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import NotesScreen from "../screens/NotesScreen";
import RecordScreen from "../screens/RecordScreen";
import SettingsScreen from "../screens/SettingsScreen";
import NoteDetailScreen from "../screens/NoteDetailScreen";
import ReportScreen from "../screens/ReportScreen";

export type MainTabParamList = {
  Notes: undefined;
  Record: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined;
  NoteDetail: { noteId: string };
  Report: { noteId: string };
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// 中央の「録音」タブだけ大きな丸ボタンとして強調表示する
function RecordTabButton(props: any) {
  const { onPress, accessibilityState } = props;
  const focused = accessibilityState?.selected;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.recordButtonWrapper}
    >
      <View style={[styles.recordButton, focused && styles.recordButtonFocused]}>
        <Ionicons name="mic" size={30} color="#fff" />
      </View>
      <Text style={[styles.recordLabel, focused && styles.recordLabelFocused]}>録音</Text>
    </TouchableOpacity>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
      }}
    >
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={{
          title: "ノート",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Record"
        component={RecordScreen}
        options={{
          title: "",
          tabBarIcon: () => null,
          tabBarButton: (props) => <RecordTabButton {...props} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: "設定",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="MainTabs"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="NoteDetail"
          component={NoteDetailScreen}
          options={{ title: "ノート詳細" }}
        />
        <Stack.Screen
          name="Report"
          component={ReportScreen}
          options={{ title: "レポート出力" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  recordButtonWrapper: {
    justifyContent: "center",
    alignItems: "center",
  },
  recordButton: {
    top: Platform.select({ ios: -18, default: -18 }),
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#c00",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  recordButtonFocused: {
    backgroundColor: "#e00",
  },
  recordLabel: {
    marginTop: -10,
    fontSize: 10,
    color: "#8e8e93",
  },
  recordLabelFocused: {
    color: "#007aff",
  },
});
