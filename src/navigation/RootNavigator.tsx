import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import NotesScreen from "../screens/NotesScreen";
import RecordScreen from "../screens/RecordScreen";
import SettingsScreen from "../screens/SettingsScreen";
import NoteDetailScreen from "../screens/NoteDetailScreen";
import ReportScreen from "../screens/ReportScreen";
import RecordCompleteScreen from "../screens/RecordCompleteScreen";

export type MainTabParamList = {
  Notes: undefined;
  Record: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined;
  NoteDetail: { noteId: string };
  Report: { noteId: string };
  RecordComplete: { noteId: string };
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

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
          title: "録音",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "mic" : "mic-outline"} size={size} color={color} />
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
        <Stack.Screen
          name="RecordComplete"
          component={RecordCompleteScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
