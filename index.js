require('dotenv').config();
const express = require('express');
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ChannelType, 
    PermissionFlagsBits 
} = require('discord.js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc'); 
const timezone = require('dayjs/plugin/timezone');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- CONFIGURACIÓN HORARIA ---
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('es'); 

// --- CONFIGURACIÓN DISCORD ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
});

// --- CONFIGURACIÓN MULTER ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let dir = 'public/uploads/';
        if (file.fieldname === 'mappingFiles') dir += 'mapping/';
        else dir += 'flyers/';
        
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, `temp_${Date.now()}_${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`)
    }
});
const upload = multer({ storage: storage });

// --- PERSISTENCIA DE DATOS (JSON) ---
const DATA_FILE = 'data.json';
let events = []; 

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const raw = fs.readFileSync(DATA_FILE);
            events = JSON.parse(raw);
            console.log(`💾 Datos cargados: ${events.length} eventos.`);
        } catch (e) {
            console.error("Error cargando data.json", e);
            events = [];
        }
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2));
    } catch (e) { console.error("Error guardando datos", e); }
}

loadData();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- API: GET ---
app.get('/api/eventos', (req, res) => {
    res.json(events);
});

// --- API: POST ---
app.post('/api/evento', upload.fields([
    { name: 'flyer', maxCount: 1 }, 
    { name: 'mappingFiles', maxCount: 10 }
]), async (req, res) => {
    
    const data = req.body;
    let files = req.files || {};

    const dateObj = dayjs.utc(data.date);
    const minutes = dateObj.minute();
    if (minutes !== 0 && minutes !== 30) {
        if(files['flyer']) fs.unlinkSync(files['flyer'][0].path);
        if(files['mappingFiles']) files['mappingFiles'].forEach(f => fs.unlinkSync(f.path));
        return res.status(400).json({ error: "La hora debe ser en punto (:00) o y media (:30)." });
    }

    const isTaken = events.some(e => e.status !== 'rejected' && dayjs(e.date).isSame(dateObj));
    if (isTaken) {
        if(files['flyer']) fs.unlinkSync(files['flyer'][0].path);
        if(files['mappingFiles']) files['mappingFiles'].forEach(f => fs.unlinkSync(f.path));
        return res.status(400).json({ error: "Fecha ocupada." });
    }

    const eventId = Date.now().toString();
    const needsCars = data.needsCars === 'true';
    const needsRadio = data.needsRadio === 'true';
    const needsMapping = data.needsMapping === 'true';
    const requiresSupport = needsCars || needsRadio || needsMapping;

    let finalMappingPaths = [];
    if (files['mappingFiles']) {
        files['mappingFiles'].forEach((file, index) => {
            const ext = path.extname(file.originalname);
            const newFilename = `${eventId}-${index + 1}${ext}`;
            const newPath = path.join('public/uploads/mapping/', newFilename);
            try {
                fs.renameSync(file.path, newPath);
                finalMappingPaths.push(newPath);
            } catch (err) { console.error(err); }
        });
    }

    const flyerPath = files['flyer'] ? files['flyer'][0].path : null;

    const newEvent = {
        id: eventId,
        userId: data.userId,
        title: data.title,
        description: data.description,
        date: dateObj.format(), 
        timestamp: dateObj.unix(), 
        flyerPath: flyerPath,
        needsCars, carsDesc: data.carsDesc || 'No',
        needsRadio,
        needsMapping, mappingDesc: data.mappingDesc || 'No',
        mappingFiles: finalMappingPaths,
        status: 'pending',
        reason: '',
        subscribers: [],    
        publicMessageId: null, 
        startNotified: false   
    };
    
    events.push(newEvent);
    saveData(); 

    // --- ENVIAR A DISCORD (ADMIN) ---
    const adminChannel = client.channels.cache.get(process.env.CHANNEL_ID_SOLICITUDES);
    if (adminChannel) {
        const embed = new EmbedBuilder()
            .setTitle(requiresSupport ? '🚨 SOLICITUD CON SOPORTE TÉCNICO' : '📢 Nueva Solicitud Estándar')
            .setColor(requiresSupport ? 0xFF0000 : 0xFFA500)
            .addFields(
                { name: '👤 Usuario', value: `<@${data.userId}>`, inline: true },
                { name: '📅 Fecha (UTC)', value: dateObj.format('DD/MM/YYYY HH:mm'), inline: true },
                { name: '📝 Título', value: data.title, inline: false },
                { name: '📄 Descripción del Evento', value: data.description, inline: false }
            );

        if (requiresSupport) {
            embed.addFields({ name: '---------------------------------', value: '**🛠️ DETALLES DEL SOPORTE SOLICITADO**' });
            if (needsCars) embed.addFields({ name: '🚗 Vehículos Solicitados', value: `\`\`\`${data.carsDesc}\`\`\``, inline: false });
            if (needsMapping) embed.addFields({ name: '🏗️ Mapeo Solicitado', value: `\`\`\`${data.mappingDesc}\`\`\``, inline: false });
            if (needsRadio) embed.addFields({ name: '📻 Emisora', value: '✅ Requiere configuración de Emisora.', inline: false });
        } else {
            embed.addFields({ name: '✅ Estado del Soporte', value: 'No requiere soporte técnico.' });
        }

        const attachments = [];
        if (newEvent.flyerPath) {
            attachments.push({ attachment: newEvent.flyerPath, name: 'flyer.png' });
            embed.setImage('attachment://flyer.png');
        }

        if (newEvent.mappingFiles.length > 0) {
            newEvent.mappingFiles.forEach((p, i) => {
                attachments.push({ attachment: p, name: `mapeo-${i+1}.png` });
            });
            embed.addFields({ name: '📂 Archivos de Mapeo', value: `Se han adjuntado ${newEvent.mappingFiles.length} imágenes de referencia.` });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`accept_${newEvent.id}`).setLabel('Aceptar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_${newEvent.id}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger)
        );

        await adminChannel.send({ embeds: [embed], files: attachments, components: [row] });
    }
    
    res.json({ success: true });
});

// --- INTERACCIONES DISCORD ---
client.on('interactionCreate', async interaction => {
    
    // --- LÓGICA BOTÓN CERRAR TICKET ---
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        await interaction.reply({ content: '🗑️ Cerrando ticket y eliminando canal en 5 segundos...', ephemeral: false });
        setTimeout(() => {
            interaction.channel.delete().catch(e => console.error("Error borrando canal:", e));
        }, 5000);
        return;
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Verificar si es un botón de evento (accept/reject/interested)
        if (!customId.includes('_')) return;

        const [action, eventId] = customId.split('_');
        const eventIndex = events.findIndex(e => e.id === eventId);
        
        if (eventIndex === -1 && action !== 'close') return interaction.reply({ content: '❌ Evento no encontrado o expirado.', ephemeral: true });
        const evt = events[eventIndex];

        // RECHAZAR
        if (action === 'reject') {
            const modal = new ModalBuilder().setCustomId(`modalReject_${eventId}`).setTitle('Motivo del Rechazo');
            const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel("Motivo").setStyle(TextInputStyle.Paragraph);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
        }

        // ACEPTAR
        if (action === 'accept') {
            events[eventIndex].status = 'accepted';
            saveData(); 

            // 1. PUBLICAR EN ANUNCIOS
            const publicChannel = client.channels.cache.get(process.env.CHANNEL_ID_ANUNCIOS);
            if (publicChannel) {
                const publicEmbed = new EmbedBuilder()
                    .setTitle(`📅 Nuevo Evento: ${evt.title}`)
                    .setDescription(evt.description)
                    .setColor(0x5865F2) 
                    .addFields(
                        { name: '🕒 Fecha y Hora', value: `<t:${evt.timestamp}:F>\n(<t:${evt.timestamp}:R>)`, inline: false },
                        { name: '👥 Interesados', value: '0 personas', inline: false }
                    )
                    .setFooter({ text: `Evento solicitado al Equipo de Eventos del PM.` });

                const filesToSend = [];
                if (evt.flyerPath) {
                    filesToSend.push({ attachment: evt.flyerPath, name: 'flyer.png' });
                    publicEmbed.setImage('attachment://flyer.png'); 
                }

                const interestBtn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`interested_${evt.id}`).setLabel('Me interesa').setEmoji('⭐').setStyle(ButtonStyle.Primary)
                );

                const sentMsg = await publicChannel.send({ embeds: [publicEmbed], files: filesToSend, components: [interestBtn] });
                events[eventIndex].publicMessageId = sentMsg.id;
                saveData(); 
            }

            // 2. CREAR TICKET SI ES NECESARIO (Lógica movida aquí)
            const requiresSupport = evt.needsCars || evt.needsRadio || evt.needsMapping;
            let ticketMention = "No requiere ticket.";

            if (requiresSupport && process.env.CATEGORY_ID_TICKETS) {
                const guild = interaction.guild;
                try {
                    // Crear canal ticket-evento-ID
                    const ticketChannel = await guild.channels.create({
                        name: `ticket-evento-${eventId}`,
                        type: ChannelType.GuildText,
                        parent: process.env.CATEGORY_ID_TICKETS, // ID de la Categoría
                        permissionOverwrites: [
                            {
                                id: guild.id, // @everyone (Bloquear ver)
                                deny: [PermissionFlagsBits.ViewChannel],
                            },
                            {
                                id: evt.userId, // Usuario solicitante (Permitir ver y escribir)
                                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
                            },
                            {
                                id: interaction.user.id, // Staff que acepta
                                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                            },
                            {
                                id: client.user.id, // Bot (Permisos totales)
                                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
                            }
                        ],
                    });
                    
                    ticketMention = ticketChannel.toString();

                    // Crear botón de Cerrar Ticket
                    const closeBtnRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('close_ticket')
                            .setLabel('Cerrar Ticket')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🗑️')
                    );

                    // Reconstruir embed básico para contexto en el ticket
                    const contextEmbed = new EmbedBuilder()
                         .setTitle(`Soporte para: ${evt.title}`)
                         .setDescription(`Canal creado para coordinar: \n${evt.needsCars ? '• Coches\n' : ''}${evt.needsMapping ? '• Mapeo\n' : ''}${evt.needsRadio ? '• Radio' : ''}`)
                         .setColor(0xFFA500);

                    // Enviar mensaje de bienvenida en el nuevo canal con el botón
                    await ticketChannel.send({
                        content: `👋 Hola <@${evt.userId}>,\n\nEste es tu canal privado de soporte. Un administrador te atenderá pronto.\nCuando finalice el soporte, pulsa el botón para borrar el chat.`,
                        embeds: [contextEmbed],
                        components: [closeBtnRow]
                    });

                } catch (error) {
                    console.error("Error creando canal de ticket:", error);
                    ticketMention = "Error al crear ticket.";
                }
            }

            await interaction.reply({ content: `✅ Evento publicado en anuncios.\n🎫 Estado Ticket: ${ticketMention}`, ephemeral: true });
            
            // Editar mensaje original para quitar botones
            await interaction.message.edit({ components: [] }); 
        }

        // ME INTERESA
        if (action === 'interested') {
            const userId = interaction.user.id;
            if (!evt.subscribers.includes(userId)) {
                events[eventIndex].subscribers.push(userId);
                saveData(); 
            } else {
                 return interaction.reply({ content: 'Ya estabas apuntado.', ephemeral: true });
            }

            const publicChannel = client.channels.cache.get(process.env.CHANNEL_ID_ANUNCIOS);
            if (publicChannel && evt.publicMessageId) {
                try {
                    const msgToEdit = await publicChannel.messages.fetch(evt.publicMessageId);
                    const oldEmbed = msgToEdit.embeds[0];
                    const newEmbed = EmbedBuilder.from(oldEmbed);
                    
                    if (evt.flyerPath) newEmbed.setImage('attachment://flyer.png');

                    const count = events[eventIndex].subscribers.length;
                    const fieldIndex = newEmbed.data.fields.findIndex(f => f.name.includes('Interesados'));
                    if (fieldIndex !== -1) newEmbed.data.fields[fieldIndex].value = `${count} persona${count === 1 ? '' : 's'}`;
                    
                    await msgToEdit.edit({ embeds: [newEmbed] });
                } catch (err) { console.error(err); }
            }
            await interaction.reply({ content: `✅ Te has apuntado a **${evt.title}**.`, ephemeral: true });
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modalReject_')) {
        const eventId = interaction.customId.split('_')[1];
        const reason = interaction.fields.getTextInputValue('reason');
        const index = events.findIndex(e => e.id === eventId);
        if (index !== -1) {
            events[index].status = 'rejected';
            events[index].reason = reason;
            saveData(); 
        }

        await interaction.reply({ content: '❌ Rechazado.', ephemeral: true });
        await interaction.message.edit({ components: [] });
    }
});

// --- CRON ---
setInterval(async () => {
    const now = dayjs.utc();
    const nowUnix = now.unix(); 

    if (now.format('HH:mm') === '00:00') {
        const mappingDir = 'public/uploads/mapping/';
        if (fs.existsSync(mappingDir)) {
            fs.readdir(mappingDir, (err, files) => {
                if (!err) {
                    for (const file of files) fs.unlink(path.join(mappingDir, file), () => {});
                    console.log("🧹 Mapeos limpios.");
                }
            });
        }
    }

    let modified = false;
    for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        if (evt.status === 'accepted' && !evt.startNotified) {
            const diffSeconds = evt.timestamp - nowUnix;
            if (diffSeconds <= 60 && diffSeconds > -120) {
                const publicChannel = client.channels.cache.get(process.env.CHANNEL_ID_ANUNCIOS);
                if (publicChannel) {
                    const startEmbed = new EmbedBuilder()
                        .setTitle(`🔔 ¡El Evento Comienza YA!: ${evt.title}`)
                        .setDescription(`El evento está empezando ahora mismo.\n\n**Interesados:** ${evt.subscribers.length} personas.`)
                        .setColor(0xFF0000) 
                        .setTimestamp();

                    await publicChannel.send({ 
                        content: `📢 ¡Atención! El evento de <@${evt.userId}> comienza ahora.`, 
                        embeds: [startEmbed] 
                    });

                    evt.subscribers.forEach(async userId => {
                        try {
                            const user = await client.users.fetch(userId);
                            await user.send(`🚀 **¡Corre!** El evento **${evt.title}** está comenzando ahora.`);
                        } catch (e) {}
                    });
                    events[i].startNotified = true;
                    modified = true;
                }
            }
        }
    }
    if (modified) saveData(); 

}, 60000); 

client.login(process.env.DISCORD_TOKEN);
app.listen(process.env.PORT, () => console.log(`Puerto ${process.env.PORT}`));