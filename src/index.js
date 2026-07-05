const express = require('express');
const cors = require('cors');
const requestIp = require('request-ip');
const prisma = require('./prismaClient');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const CAMPUS_IP = '180.252.10.25';

// Middlewares
app.use(cors());
app.use(express.json());
app.use(requestIp.mw());

// Import and register routes
const predictionRouter = require('./routes/prediction');
app.use('/api/parking', predictionRouter);

// API Check-in Endpoint
app.post('/api/parking/check-in', async (req, res) => {
  try {
    const { user_id, slot_code } = req.body;

    // Validate request body
    if (!user_id || !slot_code) {
      return res.status(400).json({ error: "Data 'user_id' dan 'slot_code' wajib disertakan." });
    }

    // IP Filtering Security
    // Check request-ip middleware value, x-forwarded-for header, or Express req.ip
    let clientIp = req.clientIp || req.headers['x-forwarded-for'] || req.ip;

    // Normalize IPv6 mapped IPv4 address (e.g., ::ffff:180.252.10.25 -> 180.252.10.25)
    if (clientIp && clientIp.startsWith('::ffff:')) {
      clientIp = clientIp.substring(7);
    }

    if (clientIp !== CAMPUS_IP) {
      console.warn(`Akses ditolak. IP Pengirim: ${clientIp}, Diharapkan: ${CAMPUS_IP}`);
      return res.status(403).json({
        error: "Akses Ditolak. Perangkat Anda harus terhubung ke Wi-Fi resmi kampus untuk mengunci slot parkir"
      });
    }

    // Check if User exists
    const user = await prisma.user.findUnique({
      where: { id: user_id }
    });
    if (!user) {
      return res.status(404).json({ error: "User tidak ditemukan." });
    }

    // Check if ParkingSlot exists
    const slot = await prisma.parkingSlot.findUnique({
      where: { slot_code: slot_code }
    });
    if (!slot) {
      return res.status(404).json({ error: "Slot parkir tidak ditemukan." });
    }

    // Check if ParkingSlot is already occupied
    if (slot.status === 'TERISI') {
      return res.status(400).json({ error: "Slot parkir sudah terisi." });
    }

    // Run database transaction to update slot status and create log
    const result = await prisma.$transaction(async (tx) => {
      const updatedSlot = await tx.parkingSlot.update({
        where: { id: slot.id },
        data: { status: 'TERISI' }
      });

      const newLog = await tx.parkingLog.create({
        data: {
          user_id: user.id,
          slot_id: slot.id,
          status: 'ACTIVE'
        }
      });

      return { updatedSlot, newLog };
    });

    return res.status(200).json({
      message: "Check-in berhasil",
      data: {
        log_id: result.newLog.id,
        user: {
          id: user.id,
          nama: user.nama,
          nim_atau_nidn: user.nim_atau_nidn
        },
        slot: {
          id: result.updatedSlot.id,
          slot_code: result.updatedSlot.slot_code,
          status: result.updatedSlot.status
        },
        check_in_time: result.newLog.check_in_time
      }
    });

  } catch (error) {
    console.error("Error during check-in transaction:", error);
    return res.status(500).json({ error: "Terjadi kesalahan internal pada server." });
  }
});

// API Force Check-Out Endpoint (SATPAM only)
app.post('/api/parking/force-check-out', async (req, res) => {
  try {
    const { slot_code, satpam_user_id } = req.body;

    // Validate request body
    if (!slot_code) {
      return res.status(400).json({ error: "Data 'slot_code' wajib disertakan." });
    }

    // Role Verification (SATPAM only)
    // We check the header 'x-user-id' or 'satpam_user_id' in body
    const userId = satpam_user_id || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: "Akses Ditolak. Diperlukan autentikasi user ID." });
    }

    const requester = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!requester || requester.role !== 'SATPAM') {
      return res.status(403).json({ error: "Akses Ditolak. Hanya Satpam yang diizinkan untuk melakukan force check-out." });
    }

    // Check if ParkingSlot exists
    const slot = await prisma.parkingSlot.findUnique({
      where: { slot_code: slot_code }
    });
    if (!slot) {
      return res.status(404).json({ error: "Slot parkir tidak ditemukan." });
    }

    // Find active log for this slot
    const activeLog = await prisma.parkingLog.findFirst({
      where: {
        slot_id: slot.id,
        status: 'ACTIVE'
      }
    });

    if (!activeLog && slot.status === 'KOSONG') {
      return res.status(400).json({ error: "Slot parkir sudah dalam status KOSONG dan tidak ada log aktif." });
    }

    // Execute transactional update
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update ParkingSlot status to KOSONG
      const updatedSlot = await tx.parkingSlot.update({
        where: { id: slot.id },
        data: { status: 'KOSONG' }
      });

      // 2. Update the active ParkingLog to COMPLETED with current timestamp
      let updatedLog = null;
      if (activeLog) {
        updatedLog = await tx.parkingLog.update({
          where: { id: activeLog.id },
          data: {
            status: 'COMPLETED',
            check_out_time: new Date()
          }
        });
      }

      return { updatedSlot, updatedLog };
    });

    return res.status(200).json({
      message: "Force check-out berhasil dilakukan oleh Satpam.",
      data: {
        slot: {
          slot_code: result.updatedSlot.slot_code,
          status: result.updatedSlot.status
        },
        log: result.updatedLog ? {
          id: result.updatedLog.id,
          user_id: result.updatedLog.user_id,
          status: result.updatedLog.status,
          check_in_time: result.updatedLog.check_in_time,
          check_out_time: result.updatedLog.check_out_time
        } : null
      }
    });

  } catch (error) {
    console.error("Error during force check-out transaction:", error);
    return res.status(500).json({ error: "Terjadi kesalahan internal pada server." });
  }
});

// GET all parking slots
app.get('/api/parking/slots', async (req, res) => {
  try {
    const slots = await prisma.parkingSlot.findMany({
      orderBy: { slot_code: 'asc' }
    });
    return res.status(200).json(slots);
  } catch (error) {
    console.error("Error fetching slots:", error);
    return res.status(500).json({ error: "Gagal mengambil data slot parkir." });
  }
});

// GET active log for a specific slot ID (includes user info)
app.get('/api/parking/slots/:id/active-log', async (req, res) => {
  try {
    const { id } = req.params;
    const activeLog = await prisma.parkingLog.findFirst({
      where: {
        slot_id: id,
        status: 'ACTIVE'
      },
      include: {
        user: {
          select: {
            nama: true,
            nim_atau_nidn: true,
            email: true
          }
        }
      }
    });

    if (!activeLog) {
      return res.status(404).json({ error: "Tidak ada log check-in aktif untuk slot ini." });
    }

    return res.status(200).json(activeLog);
  } catch (error) {
    console.error("Error fetching active log:", error);
    return res.status(500).json({ error: "Gagal mengambil rincian data check-in aktif." });
  }
});

// POST to seed database with initial users and slots
app.post('/api/parking/seed', async (req, res) => {
  try {
    // 1. Seed Satpam account
    const satpam = await prisma.user.upsert({
      where: { email: 'satpam@ulbi.ac.id' },
      update: {},
      create: {
        id: 'satpam-1',
        nim_atau_nidn: 'S001',
        nama: 'Asep Satpam',
        email: 'satpam@ulbi.ac.id',
        password: 'password123',
        role: 'SATPAM'
      }
    });

    // 2. Seed test Student accounts
    const mhs1 = await prisma.user.upsert({
      where: { email: 'mhs1@ulbi.ac.id' },
      update: {},
      create: {
        id: 'c6a4a9d-c8af-416c-bf7f-0f3cf8e3a91e',
        nim_atau_nidn: 'D3TI12345',
        nama: 'Rendi Ripaldi',
        email: 'mhs1@ulbi.ac.id',
        password: 'password123',
        role: 'MAHASISWA'
      }
    });

    const mhs2 = await prisma.user.upsert({
      where: { email: 'mhs2@ulbi.ac.id' },
      update: {},
      create: {
        id: 'mhs-2',
        nim_atau_nidn: 'D3TI12346',
        nama: 'Budi Santoso',
        email: 'mhs2@ulbi.ac.id',
        password: 'password123',
        role: 'MAHASISWA'
      }
    });

    // 3. Seed Parking Slots A01 to A12
    const slotCodes = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12'];
    const seededSlots = [];

    for (const code of slotCodes) {
      const slot = await prisma.parkingSlot.upsert({
        where: { slot_code: code },
        update: {},
        create: {
          slot_code: code,
          status: 'KOSONG'
        }
      });
      seededSlots.push(slot);
    }

    return res.status(200).json({
      message: "Seeding database berhasil!",
      users: { satpam, mhs1, mhs2 },
      slots: seededSlots
    });
  } catch (err) {
    console.error("Database seeding failed:", err);
    return res.status(500).json({ error: "Gagal memproses seeding database." });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Configured Campus IP: ${CAMPUS_IP}`);
});
