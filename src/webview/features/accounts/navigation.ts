import { createContext } from 'react';

export const AccountsNavigation = createContext<(profile?: string, create?: boolean) => void>(
  () => {},
);
