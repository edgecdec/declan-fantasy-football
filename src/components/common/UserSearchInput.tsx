'use client';

import * as React from 'react';
import { Autocomplete, TextField } from '@mui/material';

interface UserSearchInputProps {
  username: string;
  setUsername: (name: string) => void;
  disabled?: boolean;
}

export default function UserSearchInput({ username, setUsername, disabled }: UserSearchInputProps) {
  const [savedUsernames, setSavedUsernames] = React.useState<string[]>([]);

  // Load Saved Usernames
  React.useEffect(() => {
    const saved = localStorage.getItem('sleeper_usernames');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSavedUsernames(parsed);
        // We do NOT auto-set username here, we let the parent control initial state
      } catch (e) { console.error(e); }
    }
  }, []);

  return (
    <Autocomplete
      freeSolo
      options={savedUsernames}
      value={username}
      onInputChange={(e, newVal) => setUsername(newVal)}
      renderInput={(params) => (
        <TextField 
          {...params} 
          label="Sleeper Username" 
          variant="outlined" 
          sx={{ minWidth: { xs: '100%', sm: 250 }, flexGrow: 1 }} 
        />
      )}
      disabled={disabled}
    />
  );
}
