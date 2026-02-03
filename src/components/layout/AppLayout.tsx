'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AppBar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
  Avatar,
  Menu,
  MenuItem as MuiMenuItem,
  Chip,
  Tooltip
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import PieChartIcon from '@mui/icons-material/PieChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GroupsIcon from '@mui/icons-material/Groups'; // Players
import MedicalServicesIcon from '@mui/icons-material/MedicalServices'; // Medic
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'; // Performance
import HistoryIcon from '@mui/icons-material/History'; // Legacy
import BarChartIcon from '@mui/icons-material/BarChart'; // Positional
import BugReportIcon from '@mui/icons-material/BugReport';
import SportsFootballIcon from '@mui/icons-material/SportsFootball'; // Brand icon
import { useUser } from '@/context/UserContext';

const drawerWidth = 240;

const MENU_ITEMS = [
  { text: 'Home', href: '/', icon: <HomeIcon /> },
  { text: 'Luck Analyzer', href: '/expected-wins', icon: <TrendingUpIcon /> },
  { text: 'Positional Benchmarks', href: '/performance/positional', icon: <BarChartIcon /> },
  { text: 'Season Review', href: '/performance', icon: <EmojiEventsIcon /> },
  { text: 'Legacy Analyzer', href: '/league-history', icon: <HistoryIcon /> },
  { text: 'Roster Medic', href: '/medic', icon: <MedicalServicesIcon /> },
  { text: 'Portfolio Tracker', href: '/portfolio', icon: <PieChartIcon /> },
  { text: 'Player Database', href: '/players', icon: <GroupsIcon /> },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useUser();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();
  
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleClose();
    logout();
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const drawerContent = (
    <div>
      <Toolbar sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SportsFootballIcon color="primary" />
        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 'bold' }}>
          FF Analytics
        </Typography>
        <Chip label="BETA" color="secondary" size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }} />
      </Toolbar>
      <Divider />
      <List>
        {MENU_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <ListItem key={item.text} disablePadding>
              <Link href={item.href} passHref style={{ textDecoration: 'none', color: 'inherit', width: '100%' }}>
                <ListItemButton 
                  selected={isActive}
                  onClick={() => isMobile && setMobileOpen(false)}
                  sx={{
                    '&.Mui-selected': {
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': { bgcolor: 'primary.dark' },
                      '& .MuiListItemIcon-root': { color: 'inherit' }
                    }
                  }}
                >
                  <ListItemIcon sx={{ color: isActive ? 'inherit' : 'text.secondary' }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText primary={item.text} />
                </ListItemButton>
              </Link>
            </ListItem>
          );
        })}
      </List>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          bgcolor: 'background.paper',
          color: 'text.primary',
          boxShadow: 1 
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          
          <Typography variant="h6" noWrap component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1 }}>
            {MENU_ITEMS.find(i => i.href === pathname)?.text || 'Fantasy Football'}
            <Chip 
              label="BETA" 
              color="error" 
              size="small" 
              sx={{ 
                fontWeight: 'bold', 
                height: 20, 
                fontSize: '0.65rem',
                boxShadow: '0 0 8px rgba(211, 47, 47, 0.4)'
              }} 
            />
          </Typography>

          <Tooltip title="Report a Bug">
            <IconButton
              component={Link}
              href="https://github.com/edgecdec/FantasyFootballFullWebsite/issues/new"
              target="_blank"
              color="inherit"
              sx={{ mr: 1 }}
            >
              <BugReportIcon />
            </IconButton>
          </Tooltip>

          {user && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
                Welcome, <strong>{user.display_name}</strong>
              </Typography>
              <div>
                <IconButton
                  size="large"
                  aria-label="account of current user"
                  aria-controls="menu-appbar"
                  aria-haspopup="true"
                  onClick={handleMenu}
                  color="inherit"
                  sx={{ p: 0 }}
                >
                  <Avatar 
                    src={`https://sleepercdn.com/avatars/${user.avatar}`} 
                    alt={user.display_name}
                  />
                </IconButton>
                <Menu
                  id="menu-appbar"
                  anchorEl={anchorEl}
                  anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                  keepMounted
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                  open={Boolean(anchorEl)}
                  onClose={handleClose}
                >
                  <MuiMenuItem disabled>{user.display_name}</MuiMenuItem>
                  <Divider />
                  <MuiMenuItem onClick={handleLogout}>Change User</MuiMenuItem>
                </Menu>
              </div>
            </Box>
          )}
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
        aria-label="mailbox folders"
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          minHeight: '100vh',
          bgcolor: 'background.default'
        }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}