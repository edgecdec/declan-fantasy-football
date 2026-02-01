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
  useTheme
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import PieChartIcon from '@mui/icons-material/PieChart'; // Portfolio
import TrendingUpIcon from '@mui/icons-material/TrendingUp'; // Luck/Wins
import GroupsIcon from '@mui/icons-material/Groups'; // Players
import SportsFootballIcon from '@mui/icons-material/SportsFootball'; // Brand icon

const drawerWidth = 240;

const MENU_ITEMS = [
  { text: 'Home', href: '/', icon: <HomeIcon /> },
  { text: 'Portfolio Tracker', href: '/portfolio', icon: <PieChartIcon /> },
  { text: 'Luck Analyzer', href: '/expected-wins', icon: <TrendingUpIcon /> },
  { text: 'Player Database', href: '/players', icon: <GroupsIcon /> },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();

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
      
      {/* Top Bar (Mobile Only or Full Width?) -> Let's do Full Width for Title */}
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          bgcolor: 'background.paper',
          color: 'text.primary',
          boxShadow: 1 // Subtle shadow
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
          
          {/* Page Title (Dynamic based on route) */}
          <Typography variant="h6" noWrap component="div">
            {MENU_ITEMS.find(i => i.href === pathname)?.text || 'Fantasy Football'}
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Navigation Drawer */}
      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
        aria-label="mailbox folders"
      >
        {/* Mobile Drawer (Temporary) */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }} // Better open performance on mobile.
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawerContent}
        </Drawer>

        {/* Desktop Drawer (Permanent) */}
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

      {/* Main Content Area */}
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
        <Toolbar /> {/* Spacer for fixed AppBar */}
        {children}
      </Box>
    </Box>
  );
}
