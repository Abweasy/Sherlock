// Discord Activity sign-in. Only runs when the game is launched inside Discord.
import { DiscordSDK } from '@discord/embedded-app-sdk';

export function isInDiscord() {
  // Discord launches activities with these query params.
  return new URLSearchParams(window.location.search).has('frame_id');
}

export async function setupDiscord() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) throw new Error('VITE_DISCORD_CLIENT_ID is not set. Add it to .env and rebuild.');

  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  // Requests from inside Discord go through its proxy at /.proxy/
  const response = await fetch('/.proxy/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
  const { access_token } = await response.json();

  const auth = await sdk.commands.authenticate({ access_token });
  const user = auth.user;

  return {
    sdk,
    // Everyone in the same voice-channel activity shares one instance, so it makes a perfect room id.
    room: sdk.instanceId,
    clientId: user.id,
    name: user.global_name || user.username,
  };
}
