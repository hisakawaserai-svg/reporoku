import { useRef } from "react";
import { InteractionManager } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  NavigationContainer,
  NavigatorScreenParams,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import NotesScreen from "../screens/NotesScreen";
import RecordScreen from "../screens/RecordScreen";
import SummaryScreen from "../screens/SummaryScreen";
import SettingsScreen from "../screens/SettingsScreen";
import NoteDetailScreen from "../screens/NoteDetailScreen";
import ReportScreen from "../screens/ReportScreen";
import RecordCompleteScreen from "../screens/RecordCompleteScreen";
import OnboardingScreen from "../screens/OnboardingScreen";
import StorageManagementScreen from "../screens/StorageManagementScreen";
import HowToUseScreen from "../screens/HowToUseScreen";
import { getOnboardingCompleted } from "../utils/settings";
import { runCrashRecoveryCheck } from "../utils/crashRecovery";

export type MainTabParamList = {
  // resumeSessionId: クラッシュ復旧の「録音を再開する」から遷移してきた場合のみ渡される、
  // 続きから録音するセッションのID
  Record: { resumeSessionId?: string } | undefined;
  Notes: undefined;
  Summary: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  // audioNotice: クラッシュ復旧の「内容を見るだけ」で、音声が1件も復元できなかった場合に渡される
  NoteDetail: { noteId: string; jumpToBlockId?: string; audioNotice?: "missing" };
  Report: { noteId: string };
  RecordComplete: { noteId: string };
  Onboarding: undefined;
  StorageManagement: undefined;
  // section: 遷移元の画面に対応するタブを開いた状態で表示する場合に渡す
  HowToUse: { section?: "record" | "noteDetail" | "summary" | "notesList" | "settings" } | undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Record"
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
      }}
    >
      <Tab.Screen
        name="Record"
        component={RecordScreen}
        options={{
          title: "収録",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "mic" : "mic-outline"} size={size} color={color} />
          ),
        }}
      />
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
        name="Summary"
        component={SummaryScreen}
        options={{
          title: "まとめ",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "bookmark" : "bookmark-outline"} size={size} color={color} />
          ),
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
  const initialRouteName = getOnboardingCompleted() ? "MainTabs" : "Onboarding";
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  // onReadyは resetRoot 後の再遷移や開発中の Fast Refresh などで複数回呼ばれることがある。
  // ガード無しだと、まだ破棄・復元し終えていない同じクラッシュセッションに対して
  // チェックが二重に走り、同じダイアログが繰り返し表示されてしまうため、起動後1回だけに絞る
  const crashCheckStartedRef = useRef(false);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (crashCheckStartedRef.current) return;
        crashCheckStartedRef.current = true;
        // 起動直後は react-native-screens 側のレイアウトがまだ落ち着いておらず、ここで即座に
        // navigate すると初回だけ空白表示になることがあるため、操作(トランジション等)が
        // 一段落してから実行する
        InteractionManager.runAfterInteractions(() => {
          runCrashRecoveryCheck(navigationRef);
        });
      }}
    >
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{ headerBackButtonDisplayMode: "minimal" }}
      >
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
        <Stack.Screen
          name="RecordComplete"
          component={RecordCompleteScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="StorageManagement"
          component={StorageManagementScreen}
          options={{ title: "ストレージ管理" }}
        />
        <Stack.Screen
          name="HowToUse"
          component={HowToUseScreen}
          options={{ title: "使い方" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
