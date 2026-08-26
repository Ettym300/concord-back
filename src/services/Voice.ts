import { getChannelForUserCache } from '../cache/ChannelCache';
import { getUserIdBySocketId } from '../cache/UserCache';
import { addUserToVoice, countVoiceUsersInChannel, getVoiceUserByUserId, removeVoiceUserByUserId } from '../cache/VoiceCache';
import { prisma } from '../common/database';
import env from '../common/env';
import { generateError } from '../common/errorHandler';
import { emitServerVoiceUserLeft, emitServerVoiceUserJoined, emitDMVoiceUserLeft, emitDMVoiceUserJoined } from '../emits/Voice';
import { ChannelType, TextChannelTypes } from '../types/Channel';
import { FriendStatus } from '../types/Friend';
import { MessageType } from '../types/Message';
import { createMessage } from './Message/Message';
import { createSystemMessage } from './Message/MessageCreateSystem';

export const generateTurnCredentials = async () => {
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_CALLS_ID}/credentials/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CLOUDFLARE_CALLS_TOKEN}`,
    },
    body: JSON.stringify({
      ttl: 86400,
    }),
  });

  if (!res.ok) {
    return null;
  }

  return ((await res.json()) as any).iceServers;
};

/** App WS often drops every ~15s behind proxies. Leaving voice immediately
 * emits voice:left → client disconnects LiveKit → reconnect loop. */
const VOICE_DISCONNECT_GRACE_MS = 60_000;
const pendingVoiceLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const cancelPendingVoiceLeave = (userId: string) => {
  const timer = pendingVoiceLeaveTimers.get(userId);
  if (!timer) return;
  clearTimeout(timer);
  pendingVoiceLeaveTimers.delete(userId);
};

/** Leave voice only if the user does not reconnect within the grace period. */
export const scheduleVoiceLeaveOnDisconnect = (userId: string, socketId: string) => {
  cancelPendingVoiceLeave(userId);
  const timer = setTimeout(() => {
    pendingVoiceLeaveTimers.delete(userId);
    void (async () => {
      const voice = await getVoiceUserByUserId(userId);
      // Only leave if still tied to the disconnected socket (no successful rejoin).
      if (voice?.socketId === socketId) {
        await leaveVoiceChannel(userId);
      }
    })();
  }, VOICE_DISCONNECT_GRACE_MS);
  pendingVoiceLeaveTimers.set(userId, timer);
};

export const joinVoiceChannel = async (userId: string, socketId: string, channelId: string, serverId?: string) => {
  const socketUserId = await getUserIdBySocketId(socketId);

  if (socketUserId !== userId) {
    return [null, generateError('Invalid socketId or not connected to WebSocket.')] as const;
  }

  cancelPendingVoiceLeave(userId);

  const existingVoice = await getVoiceUserByUserId(userId);
  // Same channel + new socket (e.g. WS reconnect): only refresh socketId.
  // Leaving+rejoining emits voice:left and the client tears down LiveKit,
  // which causes the ~15s connect/disconnect flap in production.
  if (existingVoice?.channelId === channelId) {
    await addUserToVoice(channelId, userId, {
      socketId,
      serverId: existingVoice.serverId ?? serverId,
    });
    return [true, null] as const;
  }
  if (existingVoice) {
    await leaveVoiceChannel(userId);
  }

  const [channelCache] = await getChannelForUserCache(channelId, userId);

  if (!channelCache) {
    return [null, generateError(`Channel does not exist.`)];
  }

  if (!TextChannelTypes.includes(channelCache.type)) {
    return [null, generateError(`Cannot join voice channel.`)];
  }

  if (channelCache.type === ChannelType.DM_TEXT) {
    const isBlocked = await prisma.friend.findFirst({
      where: {
        status: FriendStatus.BLOCKED,
        OR: [
          { userId: userId, recipientId: channelCache.inbox.recipientId },
          { userId: channelCache.inbox.recipientId, recipientId: userId },
        ],
      },
    });

    if (isBlocked) {
      return [null, generateError('Cannot join voice channel.')];
    }
  }

  const count = await countVoiceUsersInChannel(channelId);

  if (count === 0) {
    createSystemMessage({
      type: MessageType.CALL_STARTED,
      channelId,
      userId,
      serverId,
    });
  }

  const voice = await addUserToVoice(channelId, userId, {
    socketId,
    serverId,
  });

  if (channelCache.serverId) {
    emitServerVoiceUserJoined(channelId, voice);
  } else {
    emitDMVoiceUserJoined(channelCache, voice);
  }

  return [true, null] as const;
};

export const leaveVoiceChannel = async (userId: string, channelId?: string) => {
  cancelPendingVoiceLeave(userId);

  const voiceUser = await getVoiceUserByUserId(userId);
  if (!voiceUser) return [null, generateError("You're not in a call.")] as const;

  if (channelId && voiceUser.channelId !== channelId) {
    return [null, generateError('You are not in this channel.')] as const;
  }
  const [channelCache] = await getChannelForUserCache(voiceUser.channelId, userId);

  if (!channelCache) {
    return [null, generateError(`Channel does not exist.`)];
  }
  await removeVoiceUserByUserId(userId);

  if (channelCache.serverId) {
    emitServerVoiceUserLeft(voiceUser.channelId, userId);
  } else {
    emitDMVoiceUserLeft(channelCache, userId);
  }

  return [true, null] as const;
};
