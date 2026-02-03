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

  // Load Saved Usernames and ensure example is present
  React.useEffect(() => {
    const saved = localStorage.getItem('sleeper_usernames');
    let list: string[] = [];
    if (saved) {
      try {
        list = JSON.parse(saved);
      } catch (e) { console.error(e); }
    }
    // Add example user if not present (optional, but good for dropdown)
    if (!list.includes('edgecdec')) {
        list.push('edgecdec');
    }
    setSavedUsernames(list);
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
          placeholder="e.g. edgecdec"
          variant="outlined" 
          helperText={
            <span>
              Don't have one? Try <strong style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setUsername('edgecdec')}>edgecdec</strong>
            </span>
          }
          sx={{ minWidth: { xs: '100%', sm: 250 }, flexGrow: 1 }} 
        />
      )}
      disabled={disabled}
    />
  );
}
