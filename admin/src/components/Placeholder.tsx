import { Typography, Box } from '@mui/material'

export default function Placeholder({ title }: { title: string }) {
  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={2}>{title}</Typography>
      <Typography color="text.secondary">Section ini sedang dalam pengembangan.</Typography>
    </Box>
  )
}
