# TV UX v1

## Scope

TV UX v1 adds a single runtime spatial-navigation layer to the existing responsive application. It does not create a separate TV build, persist focus in user state, or change the Player, Auth, Sync, storage, service worker, manifest, or Supabase APIs.

The controller works with the focusable controls already rendered by each view. It filters hidden and disabled elements, compares their on-screen rectangles, and moves to the closest candidate in the requested direction. This keeps Home, My List, global Search, Profile, Detail, dialogs, filters, cards, “Tonight”, and “Double feature” on the same UI and data paths used by mouse and touch.

## Remote controls

- D-pad arrows move spatially between visible controls. Left/Right inside a carousel moves one card at a time and keeps the same card role where possible.
- Enter and Space use native button/link activation.
- Escape, Backspace, `BrowserBack`, and `GoBack` close a dismissible dialog first, then return from Detail. The Player keeps its existing higher-priority Back controller.
- Text fields, selects, textareas, and editable content retain native arrow/caret behavior.
- Focused elements are scrolled into the nearest visible area; navigation does not wrap unexpectedly at carousel edges.

## Focus lifecycle

- Opening a dialog remembers its trigger, places focus inside the dialog, traps spatial navigation there, and restores the trigger when it closes.
- A replacement sub-dialog retains the original outside trigger.
- Non-dismissible dialogs ignore Back and backdrop gestures.
- Detail continues to use its existing item-and-trigger-role snapshot, so Back restores the originating poster, title, or action after rerenders.
- Keyboard/remote activation of primary navigation restores the last runtime focus in that view, falling back to its first visible control. Nothing is written to `localStorage`.

## Layout and accessibility

At large-screen widths the existing responsive layout gets larger navigation targets, modal controls, spacing, and a high-contrast focus ring with a non-layout-shifting glow. Cards use transform/outline rather than changing dimensions. `prefers-reduced-motion` disables decorative focus movement. Mobile bottom navigation and pointer/touch behavior are unchanged.

## Acceptance

Automated Chromium coverage validates 1280×720 and 1920×1080 layouts, carousel traversal and scrolling, cross-section movement, Detail focus restoration, modal focus/trap/Back/restore, protected dialogs, primary navigation, input arrow isolation, hidden/disabled filtering, and horizontal overflow. A physical Android/Google TV or another target remote/browser remains required for final key-code, overscan, focus visibility, and long-session acceptance.
