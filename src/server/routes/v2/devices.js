const express = require('express');
const router = express.Router();
const storage = require('../../storage');

// GET /v2/devices/paired - List paired accounts
router.get('/paired', async (req, res) => {
    try {
        const pairedAccounts = await storage.getItem('paired_accounts') || [];
        res.json(pairedAccounts);
    } catch (error) {
        console.error('Error getting paired accounts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /v2/devices/unpair - Remove device pairings
router.post('/unpair', async (req, res) => {
    try {
        const accountsToUnpair = req.body;
        if (!Array.isArray(accountsToUnpair)) {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        const pairedAccounts = await storage.getItem('paired_accounts') || [];
        const updatedAccounts = pairedAccounts.filter(account => 
            !accountsToUnpair.some(unpairing => unpairing.id === account.id)
        );

        await storage.setItem('paired_accounts', updatedAccounts);
        res.status(204).send();
    } catch (error) {
        console.error('Error unpairing devices:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /v2/devices/swap - Swap devices
router.put('/swap', async (req, res) => {
    try {
        const { sense_id } = req.body;
        if (!sense_id) {
            return res.status(400).json({ error: 'Missing sense_id' });
        }

        // Check if device exists
        const devices = await storage.getItem('devices') || [];
        const device = devices.find(d => d.id === sense_id);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Check if device is already paired
        const pairedAccounts = await storage.getItem('paired_accounts') || [];
        if (pairedAccounts.some(account => account.sense_id === sense_id)) {
            return res.status(400).json({ 
                status: 'NEW_SENSE_PAIRED_TO_DIFFERENT_ACCOUNT'
            });
        }

        // Check if current account has multiple devices
        const currentUserDevices = pairedAccounts.filter(account => account.is_self);
        if (currentUserDevices.length > 1) {
            return res.status(400).json({
                status: 'ACCOUNT_PAIRED_TO_MULTIPLE_SENSE'
            });
        }

        // Perform the swap
        const updatedAccounts = pairedAccounts.map(account => {
            if (account.is_self) {
                return { ...account, sense_id };
            }
            return account;
        });

        await storage.setItem('paired_accounts', updatedAccounts);
        res.json({ status: 'OK' });
    } catch (error) {
        console.error('Error swapping devices:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
