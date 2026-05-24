import type React from 'react';

export interface LoginScreenProps {
  businessCode: string;
  setBusinessCode: (val: string) => void;
  username: string;
  setUsername: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  handleLogin: (event: React.FormEvent) => void;
  isLoggingIn: boolean;
  loginError: string;
  isOnline: boolean;
}
