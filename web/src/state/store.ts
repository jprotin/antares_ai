// Store unique en mode vanilla : lu et écrit par les moteurs hors de React, lu dans
// React par useAppStore (state/hooks.ts).
import { createStore } from "zustand/vanilla";

import { createCallSlice, type CallSlice } from "./slices/call";
import {
  createConversationSlice,
  type ConversationSlice,
} from "./slices/conversation";
import { createLinesSlice, type LinesSlice } from "./slices/lines";
import { createProfileSlice, type ProfileSlice } from "./slices/profile";
import { createUiSlice, type UiSlice } from "./slices/ui";

export type AppState = ProfileSlice &
  ConversationSlice &
  LinesSlice &
  CallSlice &
  UiSlice;

export function createAppStore() {
  return createStore<AppState>()((...args) => ({
    ...createProfileSlice(...args),
    ...createConversationSlice(...args),
    ...createLinesSlice(...args),
    ...createCallSlice(...args),
    ...createUiSlice(...args),
  }));
}

export const store = createAppStore();
