# Collectible Pickup (Unreal Engine 5, C++)

A pickup that spins and bobs in place. When the player walks into it, it adds
points to the player's score, shows a message on screen, plays an optional
sound, and disappears.

## Add it to your project

1. Open your project in UE5 and choose **Tools → New C++ Class**.
   - Pick **Actor** as the parent class.
   - Name it exactly `CollectiblePickup` and click **Create Class**.
   - If your project was Blueprint-only, this turns it into a C++ project.
     You need Visual Studio (with the "Game development with C++" workload)
     or Rider installed.
2. Unreal creates `CollectiblePickup.h` and `CollectiblePickup.cpp` under
   `Source/<YourProject>/`. Replace everything in both files with the files
   from this folder.
3. Close the editor, build the project from Visual Studio or Rider, then open
   the editor again. (Live Coding can miss header changes, so a full build is
   safer the first time.)

## Try it

1. In the Content Browser, open **C++ Classes → <YourProject>** and drag
   `CollectiblePickup` into your level. You'll see a spinning, bobbing cube.
2. Press **Play** and walk into it. A yellow `+10 points! Score: 10` message
   appears in the top-left corner and the cube disappears.

## Customize it

Select the pickup in the level (or make a Blueprint child of it) and change
these in the **Details** panel:

| Setting         | What it does                              | Default |
|-----------------|-------------------------------------------|---------|
| Points          | Score added when collected                | 10      |
| Rotation Speed  | Spin speed, in degrees per second         | 90      |
| Bob Height      | How far it moves up and down, in cm       | 20      |
| Bob Speed       | How fast it bobs                          | 2       |
| Pickup Sound    | Sound played when collected (optional)    | none    |
| Mesh            | What it looks like (a coin, a cup...)     | Cube    |

To add particles, UI updates or anything else when it's collected, right-click
`CollectiblePickup` → **Create Blueprint class based on CollectiblePickup**,
then implement the **On Collected** event in that Blueprint.
