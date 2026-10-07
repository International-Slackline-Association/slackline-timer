import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Amplify } from 'aws-amplify';

import App from 'app';
import { COGNITO_CLIENT_ID, COGNITO_DOMAIN, COGNITO_USER_POOL_ID } from 'app/constants';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: COGNITO_USER_POOL_ID,
      userPoolClientId: COGNITO_CLIENT_ID,
      loginWith: {
        // Sign-in is the shared ISA Hosted UI (signInWithRedirect in
        // CognitoGate). Cognito only redirects to URLs registered on the app
        // client, so every origin that runs the Cognito path must be in the
        // client's callback and sign-out URL lists.
        oauth: {
          domain: COGNITO_DOMAIN,
          scopes: ['openid', 'email'],
          redirectSignIn: [window.location.origin],
          redirectSignOut: [window.location.origin],
          responseType: 'code',
        },
      },
    },
  },
});

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
