import { Socket } from 'socket.io';
import { getUserIdBySocketId, getUserPresences, socketDisconnect, updateCachePresence } from '../../cache/UserCache';
import { dateToDateTime, prisma } from '../../common/database';
import { emitUserPresenceUpdate } from '../../emits/User';
import { UserStatus } from '../../types/User';
import { getVoiceUserByUserId } from '../../cache/VoiceCache';
import { scheduleVoiceLeaveOnDisconnect } from '../../services/Voice';
import { LastOnlineStatus } from '../../services/User/User';
import { clearMembersFetched } from '../socket';

export async function onDisconnect(socket: Socket) {
  await handleDisconnect(socket);
}

const handleDisconnect = async (socket: Socket) => {
  clearMembersFetched(socket.id);
  const userId = await getUserIdBySocketId(socket.id);
  if (!userId) return;
  const presence = await getUserPresences({ userIds: [userId], includeSocketId: true, hideOffline: false });
  const isLastDisconnect = await socketDisconnect(socket.id, userId);

  const hasActivity = presence[0]?.activities?.find((a) => a.socketId === socket.id);

  if (!isLastDisconnect && hasActivity) {
    const { shouldEmit, presence } = await updateCachePresence({
      userId,
      socketId: socket.id,
      presence: {
        activities: null,
        userId,
      },
    });
    if (presence?.activities) {
      presence.activities = presence?.activities?.slice(0, 5);
    }

    emitUserPresenceUpdate(userId, { activities: presence?.activities, userId }, !shouldEmit);
  }

  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { status: true, lastOnlineStatus: true },
  });
  if (!user) return;

  if (isLastDisconnect && user.status !== UserStatus.OFFLINE) {
    emitUserPresenceUpdate(userId, { status: UserStatus.OFFLINE, userId });

    if (user.lastOnlineStatus !== LastOnlineStatus.HIDDEN) {
      await prisma.user.update({
        where: { id: userId },
        data: { lastOnlineAt: dateToDateTime() },
      });
    }
  }

  // Do not leave voice immediately: EasyPanel/nginx often drops the app WS ~every 15s.
  // Immediate leave → voice:left → client disconnects LiveKit → reconnect flap.
  // Rejoin within the grace window refreshes socketId and cancels this timer.
  const voice = await getVoiceUserByUserId(userId);
  if (voice?.socketId === socket.id) {
    scheduleVoiceLeaveOnDisconnect(userId, socket.id);
  }
};
