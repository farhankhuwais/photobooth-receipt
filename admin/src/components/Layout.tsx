import { useState } from 'react'
import { Outlet, useNavigate, NavLink } from 'react-router-dom'
import {
  AppBar, Toolbar, Typography, Box, Drawer, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, IconButton, Divider, Menu, MenuItem, Avatar,
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import GroupIcon from '@mui/icons-material/Group'
import PhotoIcon from '@mui/icons-material/Photo'
import StyleIcon from '@mui/icons-material/Style'
import PaletteIcon from '@mui/icons-material/Palette'
import BookmarkIcon from '@mui/icons-material/Bookmark'
import SlideshowIcon from '@mui/icons-material/Slideshow'
import HistoryIcon from '@mui/icons-material/History'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import PaymentsIcon from '@mui/icons-material/Payments'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import { useAuth } from '@/context/AuthContext'

const drawerWidth = 240

const navItems = [
  { label: 'Manage', icon: <DashboardIcon />, path: '/manage', roles: ['super_admin', 'tenant_admin', 'tenant_user'] },
  { label: 'Overview', icon: <DashboardIcon />, path: '/', roles: ['super_admin'] },
  { label: 'Tenants', icon: <GroupIcon />, path: '/tenants', roles: ['super_admin'] },
  { label: 'Users', icon: <GroupIcon />, path: '/users', roles: ['super_admin'] },
  { label: 'Photos', icon: <PhotoIcon />, path: '/photos', roles: ['super_admin', 'tenant_admin'] },
  { label: 'Frames', icon: <StyleIcon />, path: '/frames', roles: ['super_admin', 'tenant_admin'] },
  { label: 'Designs', icon: <PaletteIcon />, path: '/designs', roles: ['super_admin', 'tenant_admin'] },
  { label: 'Presets', icon: <BookmarkIcon />, path: '/presets', roles: ['super_admin', 'tenant_admin'] },
  { label: 'Attract', icon: <SlideshowIcon />, path: '/attract', roles: ['super_admin', 'tenant_admin'] },
  { label: 'Audit Log', icon: <HistoryIcon />, path: '/audit', roles: ['super_admin'] },
  { label: 'Pricing Tiers', icon: <LocalOfferIcon />, path: '/tiers', roles: ['super_admin'] },
  { label: 'Billing', icon: <PaymentsIcon />, path: '/billing', roles: ['super_admin'] },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings', roles: ['super_admin', 'tenant_admin'] },
]

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    setAnchorEl(null)
    await signOut()
    navigate('/login')
  }

  const drawer = (
    <Box>
      <Toolbar sx={{ bgcolor: 'primary.main', color: 'white' }}>
        <Typography variant="h6" fontWeight={700}>Achipix Admin</Typography>
      </Toolbar>
      <Divider />
      <List>
        {navItems.filter((item) => !item.roles || (user?.role && item.roles.includes(user.role))).map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              component={NavLink}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              sx={{
                '&.active': { bgcolor: 'primary.light', color: 'primary.main' },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            sx={{ mr: 2, display: { md: 'none' } }}
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap fontWeight={700} sx={{ flexGrow: 1 }}>
            Admin Dashboard
          </Typography>
          <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)}>
            <Avatar sx={{ width: 32, height: 32 }}>{user?.email.charAt(0).toUpperCase() || 'A'}</Avatar>
          </IconButton>
          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
            <MenuItem disabled>{user?.email}</MenuItem>
            <MenuItem onClick={handleLogout}><ListItemIcon><LogoutIcon /></ListItemIcon>Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: 3, pt: 9 }}>
        <Outlet />
      </Box>
    </Box>
  )
}
