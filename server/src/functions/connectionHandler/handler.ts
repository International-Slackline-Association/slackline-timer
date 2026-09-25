import { APIGatewayProxyHandler } from 'aws-lambda';
import { db } from 'core/db';

export const main: APIGatewayProxyHandler = async (event) => {
  const routeKey = event.requestContext.routeKey!;
  const connectionId = event.requestContext.connectionId!;

  if (routeKey === '$connect') {
    // The sessionId requirement belongs to $connect alone — API Gateway attaches
    // queryStringParameters to no other route, so a shared guard above the branch
    // 400s every real $disconnect before it can delete anything (core/db.ts).
    const sessionId = event.queryStringParameters?.sessionId;
    if (!sessionId) {
      return { statusCode: 400, body: 'Missing sessionId.' };
    }
    try {
      // Set by the $connect authorizer for event-read-token (overlay)
      // connections; the messageHandler drops anything they try to send.
      const readOnly = event.requestContext.authorizer?.readOnly === 'true';
      await db.addConnection({ connectionId, sessionId, readOnly });
      return { statusCode: 200, body: 'Connected.' };
    } catch (err) {
      console.error(err);
      return { statusCode: 500, body: 'Connection failed.' };
    }
  }

  if (routeKey === '$disconnect') {
    try {
      const sessionId = await db.getConnectionSession(connectionId);
      if (!sessionId) {
        // A socket predating the map, a duplicate $disconnect, or rows already
        // expired/410-pruned: nothing is addressable by key, so the TTL is the
        // backstop. Never an error — this route has no client to report one to.
        console.log(`disconnect: no session mapping for ${connectionId}, leaving it to the TTL`);
        return { statusCode: 200, body: 'Disconnected.' };
      }
      await db.removeConnection({ sessionId, connectionId });
      return { statusCode: 200, body: 'Disconnected.' };
    } catch (err) {
      console.error(err);
      return { statusCode: 500, body: 'Disconnection failed.' };
    }
  }

  throw new Error(`Unsupported route: ${routeKey}`);
};
