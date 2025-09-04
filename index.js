const { Client, GatewayIntentBits, Collection, Events, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionResponseType, MessageFlags } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

class BochiBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildEmojisAndStickers
            ]
        });

        this.config = {
            botSettings: {
                autoReaction: true,
                aiComment: true,
                reactionEmojis: ['👍', '❤️', '🎨', '✨', '🔥'],
                customEmojis: [], // 存储服务器自定义表情
                allowedRoles: [], // 存储允许配置的角色ID
                aiPrompt: '请用中文对这张图片进行简短的正面点评，语气要友好温馨，就像可爱的小狗波奇在夸奖主人一样。点评要真诚且具体，不要过于夸张。请控制在50字以内。' // AI点评提示词
            },
            apiSettings: {
                geminiApiKeys: [],
                geminiCurrentIndex: 0,
                geminiModel: 'gemini-1.5-flash',
                openaiApiUrl: '',
                openaiApiKey: '',
                openaiModel: 'gpt-4-vision-preview',
                useGemini: true,
                availableModels: {
                    gemini: [],
                    openai: []
                }
            }
        };

        this.commands = new Collection();
        this.setupCommands();
        this.setupEventHandlers();
    }

    setupCommands() {
        // 波奇面板命令
        const panelCommand = {
            name: 'bochi',
            description: '打开波奇机器人配置面板',
            execute: async (interaction) => {
                if (!this.checkPermission(interaction)) {
                    return await interaction.reply({
                        content: '❌ 您没有权限使用此命令。请联系管理员。',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const embed = new EmbedBuilder()
                    .setColor('#FFB6C1')
                    .setTitle('🐕 波奇机器人控制面板')
                    .setDescription('请选择要配置的功能：')
                    .addFields(
                        { name: '🎨 图片反应', value: `当前状态: ${this.config.botSettings.autoReaction ? '开启' : '关闭'}`, inline: true },
                        { name: '💬 AI点评', value: `当前状态: ${this.config.botSettings.aiComment ? '开启' : '关闭'}`, inline: true },
                        { name: '🤖 AI服务', value: `当前使用: ${this.config.apiSettings.useGemini ? 'Gemini' : 'OpenAI'}`, inline: true }
                    );

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('bot_settings')
                            .setLabel('机器人设置')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('⚙️'),
                        new ButtonBuilder()
                            .setCustomId('api_settings')
                            .setLabel('API配置')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🔧'),
                        new ButtonBuilder()
                            .setCustomId('permission_settings')
                            .setLabel('权限设置')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🔒')
                    );

                await interaction.reply({
                    embeds: [embed],
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
            }
        };

        this.commands.set(panelCommand.name, panelCommand);
    }

    setupEventHandlers() {
        this.client.once(Events.ClientReady, () => {
            console.log(`✅ 波奇机器人已启动! 登录为 ${this.client.user.tag}`);
            this.registerSlashCommands();
        });

        // 处理斜杠命令
        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (interaction.isChatInputCommand()) {
                const command = this.commands.get(interaction.commandName);
                if (command) {
                    try {
                        await command.execute(interaction);
                    } catch (error) {
                        console.error('命令执行错误:', error);
                        try {
                            const reply = { content: '执行命令时发生错误！', flags: MessageFlags.Ephemeral };
                            if (interaction.replied || interaction.deferred) {
                                await interaction.followUp(reply);
                            } else {
                                await interaction.reply(reply);
                            }
                        } catch (followupError) {
                            console.error('无法发送错误消息:', followupError.message);
                        }
                    }
                }
            }

            // 处理按钮交互
            if (interaction.isButton()) {
                try {
                    await this.handleButtonInteraction(interaction);
                } catch (error) {
                    console.error('按钮交互错误:', error);
                }
            }

            // 处理选择菜单交互
            if (interaction.isStringSelectMenu()) {
                try {
                    await this.handleSelectMenuInteraction(interaction);
                } catch (error) {
                    console.error('选择菜单交互错误:', error);
                }
            }

            // 处理模态框交互
            if (interaction.isModalSubmit()) {
                try {
                    await this.handleModalInteraction(interaction);
                } catch (error) {
                    console.error('模态框交互错误:', error);
                }
            }
        });

        // 处理消息（图片检测）
        this.client.on(Events.MessageCreate, async (message) => {
            if (message.author.bot) return;
            
            if (message.attachments.size > 0) {
                for (const attachment of message.attachments.values()) {
                    if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                        await this.handleImageMessage(message, attachment);
                    }
                }
            }
        });
    }

    async handleButtonInteraction(interaction) {
        // 检查交互是否还有效
        if (!interaction.isButton() || interaction.replied || interaction.deferred) {
            return;
        }

        if (!this.checkPermission(interaction)) {
            return await interaction.reply({
                content: '❌ 您没有权限使用此功能。',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (interaction.customId) {
            case 'bot_settings':
                await this.showBotSettings(interaction);
                break;
            case 'api_settings':
                await this.showApiSettings(interaction);
                break;
            case 'permission_settings':
                await this.showPermissionSettings(interaction);
                break;
            case 'toggle_reaction':
                this.config.botSettings.autoReaction = !this.config.botSettings.autoReaction;
                await this.showBotSettings(interaction);
                break;
            case 'toggle_comment':
                this.config.botSettings.aiComment = !this.config.botSettings.aiComment;
                await this.showBotSettings(interaction);
                break;
            case 'edit_emojis':
                await this.showEmojiModal(interaction);
                break;
            case 'edit_ai_prompt':
                await this.showPromptModal(interaction);
                break;
            case 'api_gemini_config':
                await this.showGeminiModal(interaction);
                break;
            case 'api_openai_config':
                await this.showOpenAIModal(interaction);
                break;
            case 'test_api':
                await this.testApiConnection(interaction);
                break;
            case 'get_models':
                await this.fetchAvailableModels(interaction);
                break;
            case 'get_server_emojis':
                await this.getServerEmojis(interaction);
                break;
        }
    }

    async showBotSettings(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🐕 机器人设置')
            .addFields(
                { name: '🎨 自动图片反应', value: this.config.botSettings.autoReaction ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '💬 AI图片点评', value: this.config.botSettings.aiComment ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '😊 标准表情', value: this.config.botSettings.reactionEmojis.join(' '), inline: false },
                { name: '🎭 服务器表情', value: this.config.botSettings.customEmojis.length > 0 ? this.config.botSettings.customEmojis.join(' ') : '无', inline: false }
            );

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_reaction')
                    .setLabel(this.config.botSettings.autoReaction ? '关闭反应' : '开启反应')
                    .setStyle(this.config.botSettings.autoReaction ? ButtonStyle.Danger : ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('toggle_comment')
                    .setLabel(this.config.botSettings.aiComment ? '关闭点评' : '开启点评')
                    .setStyle(this.config.botSettings.aiComment ? ButtonStyle.Danger : ButtonStyle.Success)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('edit_emojis')
                    .setLabel('编辑标准表情')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('get_server_emojis')
                    .setLabel('获取服务器表情')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('edit_ai_prompt')
                    .setLabel('编辑AI提示词')
                    .setStyle(ButtonStyle.Success)
            );

        await interaction.update({
            embeds: [embed],
            components: [row1, row2]
        });
    }

    async showApiSettings(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🔧 API设置')
            .addFields(
                { name: '🤖 当前AI服务', value: this.config.apiSettings.useGemini ? 'Gemini' : 'OpenAI', inline: true },
                { name: '📡 Gemini API数量', value: this.config.apiSettings.geminiApiKeys.length.toString(), inline: true },
                { name: '🔗 OpenAI配置', value: this.config.apiSettings.openaiApiKey ? '已配置' : '未配置', inline: true },
                { name: '🎯 当前模型', value: this.config.apiSettings.useGemini ? this.config.apiSettings.geminiModel : this.config.apiSettings.openaiModel, inline: false }
            );

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('api_gemini_config')
                    .setLabel('配置Gemini')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('api_openai_config')
                    .setLabel('配置OpenAI')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('test_api')
                    .setLabel('测试连接')
                    .setStyle(ButtonStyle.Success)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_api_service')
                    .setPlaceholder('选择AI服务')
                    .addOptions([
                        {
                            label: 'Gemini',
                            description: '使用Google Gemini API',
                            value: 'gemini'
                        },
                        {
                            label: 'OpenAI',
                            description: '使用OpenAI兼容API',
                            value: 'openai'
                        }
                    ])
            );

        const row3 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('get_models')
                    .setLabel('获取可用模型')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.update({
            embeds: [embed],
            components: [row1, row2, row3]
        });
    }

    async showPermissionSettings(interaction) {
        const guild = interaction.guild;
        const allowedRoles = this.config.botSettings.allowedRoles
            .map(roleId => guild.roles.cache.get(roleId)?.name || '未知角色')
            .join(', ') || '无';

        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🔒 权限设置')
            .addFields(
                { name: '👥 允许的角色', value: allowedRoles, inline: false },
                { name: '💡 说明', value: '只有拥有指定角色的用户才能使用机器人配置功能', inline: false }
            );

        // 创建角色选择菜单
        const roles = guild.roles.cache
            .filter(role => !role.managed && role.id !== guild.id)
            .first(25); // Discord限制最多25个选项

        if (roles.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_allowed_roles')
                .setPlaceholder('选择允许的角色')
                .setMaxValues(Math.min(roles.length, 10))
                .addOptions(roles.map(role => ({
                    label: role.name,
                    value: role.id,
                    description: `成员数: ${role.members.size}`,
                    default: this.config.botSettings.allowedRoles.includes(role.id)
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.update({
                embeds: [embed],
                components: [row]
            });
        } else {
            await interaction.update({
                embeds: [embed],
                components: []
            });
        }
    }

    async showGeminiModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('gemini_config_modal')
            .setTitle('Gemini API 配置');

        const apiKeysInput = new TextInputBuilder()
            .setCustomId('gemini_api_keys')
            .setLabel('Gemini API Keys (用逗号分隔)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(this.config.apiSettings.geminiApiKeys.join(','))
            .setRequired(false);

        const modelInput = new TextInputBuilder()
            .setCustomId('gemini_model')
            .setLabel('模型名称')
            .setStyle(TextInputStyle.Short)
            .setValue(this.config.apiSettings.geminiModel)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(apiKeysInput),
            new ActionRowBuilder().addComponents(modelInput)
        );

        await interaction.showModal(modal);
    }

    async showOpenAIModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('openai_config_modal')
            .setTitle('OpenAI API 配置');

        const apiUrlInput = new TextInputBuilder()
            .setCustomId('openai_api_url')
            .setLabel('API URL')
            .setStyle(TextInputStyle.Short)
            .setValue(this.config.apiSettings.openaiApiUrl)
            .setRequired(false);

        const apiKeyInput = new TextInputBuilder()
            .setCustomId('openai_api_key')
            .setLabel('API Key')
            .setStyle(TextInputStyle.Short)
            .setValue(this.config.apiSettings.openaiApiKey)
            .setRequired(false);

        const modelInput = new TextInputBuilder()
            .setCustomId('openai_model')
            .setLabel('模型名称')
            .setStyle(TextInputStyle.Short)
            .setValue(this.config.apiSettings.openaiModel)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(apiUrlInput),
            new ActionRowBuilder().addComponents(apiKeyInput),
            new ActionRowBuilder().addComponents(modelInput)
        );

        await interaction.showModal(modal);
    }

    async showEmojiModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('emoji_config_modal')
            .setTitle('配置反应表情');

        const emojiInput = new TextInputBuilder()
            .setCustomId('reaction_emojis')
            .setLabel('反应表情 (用空格分隔)')
            .setStyle(TextInputStyle.Short)
            .setValue(this.config.botSettings.reactionEmojis.join(' '))
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(emojiInput)
        );

        await interaction.showModal(modal);
    }

    async showPromptModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('prompt_config_modal')
            .setTitle('配置AI点评提示词');

        const promptInput = new TextInputBuilder()
            .setCustomId('ai_prompt')
            .setLabel('AI点评提示词')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(this.config.botSettings.aiPrompt)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(promptInput)
        );

        await interaction.showModal(modal);
    }

    async handleSelectMenuInteraction(interaction) {
        // 检查交互是否还有效
        if (!interaction.isStringSelectMenu() || interaction.replied || interaction.deferred) {
            return;
        }

        if (!this.checkPermission(interaction)) {
            return await interaction.reply({
                content: '❌ 您没有权限使用此功能。',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (interaction.customId) {
            case 'select_api_service':
                this.config.apiSettings.useGemini = interaction.values[0] === 'gemini';
                await this.showApiSettings(interaction);
                break;
            case 'select_allowed_roles':
                this.config.botSettings.allowedRoles = interaction.values;
                await this.showPermissionSettings(interaction);
                break;
            case 'select_gemini_model':
                this.config.apiSettings.geminiModel = interaction.values[0];
                await this.showApiSettings(interaction);
                break;
            case 'select_openai_model':
                this.config.apiSettings.openaiModel = interaction.values[0];
                await this.showApiSettings(interaction);
                break;
        }
    }

    async handleModalInteraction(interaction) {
        // 检查交互是否还有效
        if (!interaction.isModalSubmit() || interaction.replied || interaction.deferred) {
            return;
        }

        if (!this.checkPermission(interaction)) {
            return await interaction.reply({
                content: '❌ 您没有权限使用此功能。',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (interaction.customId) {
            case 'gemini_config_modal':
                const geminiApiKeys = interaction.fields.getTextInputValue('gemini_api_keys');
                const geminiModel = interaction.fields.getTextInputValue('gemini_model');
                
                if (geminiApiKeys) {
                    this.config.apiSettings.geminiApiKeys = geminiApiKeys
                        .split(',')
                        .map(key => key.trim())
                        .filter(key => key.length > 0);
                }
                if (geminiModel) {
                    this.config.apiSettings.geminiModel = geminiModel;
                }
                
                await interaction.reply({
                    content: '✅ Gemini配置已更新！',
                    flags: MessageFlags.Ephemeral
                });
                break;

            case 'openai_config_modal':
                const openaiApiUrl = interaction.fields.getTextInputValue('openai_api_url');
                const openaiApiKey = interaction.fields.getTextInputValue('openai_api_key');
                const openaiModel = interaction.fields.getTextInputValue('openai_model');
                
                if (openaiApiUrl) this.config.apiSettings.openaiApiUrl = openaiApiUrl;
                if (openaiApiKey) this.config.apiSettings.openaiApiKey = openaiApiKey;
                if (openaiModel) this.config.apiSettings.openaiModel = openaiModel;
                
                await interaction.reply({
                    content: '✅ OpenAI配置已更新！',
                    flags: MessageFlags.Ephemeral
                });
                break;

            case 'emoji_config_modal':
                const emojis = interaction.fields.getTextInputValue('reaction_emojis');
                this.config.botSettings.reactionEmojis = emojis
                    .split(' ')
                    .filter(emoji => emoji.trim().length > 0);
                
                await interaction.reply({
                    content: '✅ 表情配置已更新！',
                    flags: MessageFlags.Ephemeral
                });
                break;

            case 'prompt_config_modal':
                const aiPrompt = interaction.fields.getTextInputValue('ai_prompt');
                
                if (aiPrompt) {
                    this.config.botSettings.aiPrompt = aiPrompt;
                }
                
                await interaction.reply({
                    content: '✅ AI提示词已更新！',
                    flags: MessageFlags.Ephemeral
                });
                break;
        }
    }

    async handleImageMessage(message, attachment) {
        // 自动反应功能
        if (this.config.botSettings.autoReaction) {
            // 合并标准表情和自定义表情
            const allEmojis = [...this.config.botSettings.reactionEmojis, ...this.config.botSettings.customEmojis];
            
            if (allEmojis.length > 0) {
                const randomEmoji = allEmojis[Math.floor(Math.random() * allEmojis.length)];
                try {
                    await message.react(randomEmoji);
                } catch (error) {
                    console.error('添加反应失败:', error);
                    // 如果是自定义表情失败，尝试使用标准表情
                    if (this.config.botSettings.reactionEmojis.length > 0) {
                        const fallbackEmoji = this.config.botSettings.reactionEmojis[
                            Math.floor(Math.random() * this.config.botSettings.reactionEmojis.length)
                        ];
                        try {
                            await message.react(fallbackEmoji);
                        } catch (fallbackError) {
                            console.error('备用表情也失败:', fallbackError);
                        }
                    }
                }
            }
        }

        // AI点评功能
        if (this.config.botSettings.aiComment) {
            try {
                await message.channel.sendTyping();
                
                let comment;
                if (this.config.apiSettings.useGemini && this.config.apiSettings.geminiApiKeys.length > 0) {
                    comment = await this.getGeminiImageComment(attachment.url);
                } else if (!this.config.apiSettings.useGemini && this.config.apiSettings.openaiApiKey) {
                    comment = await this.getOpenAIImageComment(attachment.url);
                } else {
                    comment = this.getLocalImageComment();
                }

                if (comment) {
                    await message.reply(comment);
                }
            } catch (error) {
                console.error('AI点评失败:', error);
                // 静默失败，不向用户显示错误
            }
        }
    }

    async getGeminiImageComment(imageUrl) {
        try {
            // 轮询使用API密钥
            const currentApiKey = this.config.apiSettings.geminiApiKeys[this.config.apiSettings.geminiCurrentIndex];
            this.config.apiSettings.geminiCurrentIndex = 
                (this.config.apiSettings.geminiCurrentIndex + 1) % this.config.apiSettings.geminiApiKeys.length;

            const genAI = new GoogleGenerativeAI(currentApiKey);
            const model = genAI.getGenerativeModel({ model: this.config.apiSettings.geminiModel });

            // 下载图片
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const imageData = Buffer.from(response.data).toString('base64');

            const prompt = this.config.botSettings.aiPrompt;

            const result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: imageData,
                        mimeType: response.headers['content-type'] || 'image/jpeg'
                    }
                }
            ]);

            return result.response.text();
        } catch (error) {
            console.error('Gemini API调用失败:', error);
            return null;
        }
    }

    async getOpenAIImageComment(imageUrl) {
        try {
            const response = await axios.post(
                `${this.config.apiSettings.openaiApiUrl}/v1/chat/completions`,
                {
                    model: this.config.apiSettings.openaiModel,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: this.config.botSettings.aiPrompt
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: imageUrl
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 300
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.config.apiSettings.openaiApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('OpenAI API调用失败:', error);
            return null;
        }
    }

    getLocalImageComment() {
        const comments = [
            "🎨 哇！这张图片真的很棒呢！波奇觉得色彩搭配很漂亮～",
            "✨ 好美的画面啊！波奇看了心情都变好了～",
            "🔥 这个构图真不错！波奇给你点个赞～",
            "💖 真是一张令人印象深刻的图片！波奇很喜欢～",
            "🌟 哇塞！这个视角很独特呢！波奇觉得很有创意～",
            "🎯 画面细节处理得很好！波奇觉得很用心～",
            "🌈 色彩真丰富！波奇看得眼花缭乱～",
            "📸 拍得真好！波奇觉得很有艺术感～"
        ];
        
        return comments[Math.floor(Math.random() * comments.length)];
    }

    async testApiConnection(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let testResult = '';

        if (this.config.apiSettings.useGemini) {
            if (this.config.apiSettings.geminiApiKeys.length === 0) {
                testResult = '❌ 未配置Gemini API密钥';
            } else {
                try {
                    const genAI = new GoogleGenerativeAI(this.config.apiSettings.geminiApiKeys[0]);
                    const model = genAI.getGenerativeModel({ model: this.config.apiSettings.geminiModel });
                    
                    const result = await model.generateContent("测试连接");
                    testResult = '✅ Gemini API连接成功！';
                } catch (error) {
                    testResult = `❌ Gemini API连接失败: ${error.message}`;
                }
            }
        } else {
            if (!this.config.apiSettings.openaiApiKey || !this.config.apiSettings.openaiApiUrl) {
                testResult = '❌ 未配置OpenAI API信息';
            } else {
                try {
                    const response = await axios.post(
                        `${this.config.apiSettings.openaiApiUrl}/v1/chat/completions`,
                        {
                            model: this.config.apiSettings.openaiModel,
                            messages: [{ role: "user", content: "测试连接" }],
                            max_tokens: 10
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${this.config.apiSettings.openaiApiKey}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    testResult = '✅ OpenAI API连接成功！';
                } catch (error) {
                    testResult = `❌ OpenAI API连接失败: ${error.response?.data?.error?.message || error.message}`;
                }
            }
        }

        await interaction.editReply({ content: testResult });
    }

    async fetchAvailableModels(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let result = '';

        // 获取Gemini模型（预设）
        this.config.apiSettings.availableModels.gemini = [
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-1.0-pro',
            'gemini-1.0-pro-vision'
        ];

        // 获取OpenAI模型
        if (this.config.apiSettings.openaiApiKey && this.config.apiSettings.openaiApiUrl) {
            try {
                const response = await axios.get(
                    `${this.config.apiSettings.openaiApiUrl}/v1/models`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.config.apiSettings.openaiApiKey}`
                        }
                    }
                );
                
                this.config.apiSettings.availableModels.openai = response.data.data
                    .map(model => model.id)
                    .filter(id => id.includes('vision') || id.includes('gpt-4'));
                
                result = `✅ 已获取可用模型列表！\n\n` +
                    `**Gemini模型**: ${this.config.apiSettings.availableModels.gemini.length}个\n` +
                    `**OpenAI模型**: ${this.config.apiSettings.availableModels.openai.length}个`;
            } catch (error) {
                result = `⚠️ Gemini模型列表已更新，但OpenAI模型获取失败: ${error.message}`;
            }
        } else {
            result = `✅ Gemini模型列表已更新！\n⚠️ 请先配置OpenAI API信息以获取OpenAI模型列表。`;
        }

        await interaction.editReply({ content: result });
    }

    async getServerEmojis(interaction) {
        try {
            const guild = interaction.guild;
            if (!guild) {
                await interaction.reply({
                    content: '❌ 无法获取服务器信息。',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const emojis = guild.emojis.cache;

            if (emojis.size === 0) {
                await interaction.reply({
                    content: '❌ 这个服务器没有自定义表情。',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // 获取所有可用的自定义表情，包括动态表情
            const emojiList = emojis.map(emoji => {
                if (emoji.animated) {
                    return `<a:${emoji.name}:${emoji.id}>`;
                } else {
                    return `<:${emoji.name}:${emoji.id}>`;
                }
            });
            
            // 更新配置
            this.config.botSettings.customEmojis = emojiList;

            await interaction.reply({
                content: `✅ 已成功获取 ${emojiList.length} 个服务器表情！\n\n` +
                         `表情预览: ${emojiList.slice(0, 8).join(' ')}` +
                         (emojiList.length > 8 ? ` 等${emojiList.length}个...` : ''),
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('获取服务器表情失败:', error);
            await interaction.reply({
                content: '❌ 获取服务器表情时发生错误。',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    checkPermission(interaction) {
        // 如果没有设置任何角色权限，则默认允许所有人使用
        if (this.config.botSettings.allowedRoles.length === 0) {
            return true;
        }

        // 检查用户是否拥有指定的角色
        const member = interaction.member;
        return this.config.botSettings.allowedRoles.some(roleId => 
            member.roles.cache.has(roleId)
        );
    }

    async registerSlashCommands() {
        const commands = [
            {
                name: 'bochi',
                description: '打开波奇机器人配置面板'
            }
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        try {
            console.log('开始注册斜杠命令...');
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: commands }
            );
            console.log('✅ 斜杠命令注册成功！');
        } catch (error) {
            console.error('斜杠命令注册失败:', error);
        }
    }

    start() {
        if (!process.env.DISCORD_TOKEN) {
            console.error('❌ 错误: 请在.env文件中设置DISCORD_TOKEN');
            process.exit(1);
        }

        this.client.login(process.env.DISCORD_TOKEN);
    }
}

// 启动机器人
const bot = new BochiBot();
bot.start();