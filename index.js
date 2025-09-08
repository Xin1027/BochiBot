const { Client, GatewayIntentBits, Collection, Events, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionResponseType, MessageFlags } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

class BochiBot {
    constructor() {
        // 尝试使用完整权限，如果失败则降级到基础权限
        this.fullPermissions = true;  // 直接使用完整权限启动
        this.client = this.createClient(true);
        
        // 监听连接错误
        this.client.on('error', (error) => {
            if (error.message.includes('disallowed intents') || error.message.includes('Used disallowed intents')) {
                console.log('⚠️  完整权限未启用，切换到基础模式...');
                this.fullPermissions = false;
                this.restartWithBasicPermissions();
            } else {
                console.error('Discord连接错误:', error);
            }
        });

        this.config = {
            botSettings: {
                autoReaction: true,
                aiComment: true,
                reactionEmojis: ['👍', '❤️', '🎨', '✨', '🔥'],
                customEmojis: [], // 存储服务器自定义表情
                serverEmojisCache: [], // 缓存所有服务器表情
                selectedServerEmojis: [], // 用户选择的服务器表情
                allowedRoles: [], // 存储允许配置的角色ID
                aiPrompt: '请用中文对这张图片进行简短的正面点评，语气要友好温馨。点评要真诚且具体，不要过于夸张。请控制在50字以内。', 
                channelSettings: {}, // 按频道存储不同的设置 {channelId: {autoReaction: bool, aiComment: bool, ...}}
                blockedUsers: new Set(), // 不希望被机器人反应的用户ID集合
                channelStats: {} // 频道统计信息 {channelId: {name: string, reactionCount: number, lastUpdate: Date}}
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

    createClient(fullPermissions = true) {
        if (fullPermissions) {
            return new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.MessageContent,
                    GatewayIntentBits.GuildEmojisAndStickers
                ]
            });
        } else {
            return new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildEmojisAndStickers
                ]
            });
        }
    }

    async restartWithBasicPermissions() {
        try {
            await this.client.destroy();
        } catch (error) {
            console.log('清理旧客户端时出错:', error.message);
        }
        
        this.client = this.createClient(false);
        this.setupEventHandlers();
        
        try {
            await this.client.login(process.env.DISCORD_TOKEN);
        } catch (error) {
            console.error('使用基础权限登录失败:', error);
        }
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

                // 获取被阻止用户名单
                const blockedUsersList = Array.from(this.config.botSettings.blockedUsers);
                const blockedUsersText = blockedUsersList.length > 0 
                    ? blockedUsersList.slice(0, 5).map(userId => `<@${userId}>`).join(', ') + 
                      (blockedUsersList.length > 5 ? `等${blockedUsersList.length}人` : '')
                    : '无';
                
                // 获取频道统计信息
                const totalChannels = Object.keys(this.config.botSettings.channelSettings).length;
                const totalReactions = Object.values(this.config.botSettings.channelStats)
                    .reduce((sum, stat) => sum + stat.reactionCount, 0);
                
                // 检查API配置状态
                const hasGeminiApi = this.config.apiSettings.geminiApiKeys.length > 0;
                const hasOpenAiApi = this.config.apiSettings.openaiApiKey !== '';
                const apiStatus = hasGeminiApi || hasOpenAiApi ? '✅ 已配置' : '❌ 未配置';

                const embed = new EmbedBuilder()
                    .setColor('#FFB6C1')
                    .setTitle('🐕 波奇机器人控制面板')
                    .setDescription('📊 **系统状态概览**')
                    .addFields(
                        { name: '🎨 全局图片反应', value: this.config.botSettings.autoReaction ? '✅ 开启' : '❌ 关闭', inline: true },
                        { name: '💬 全局AI点评', value: this.config.botSettings.aiComment ? '✅ 开启' : '❌ 关闭', inline: true },
                        { name: '🤖 AI服务状态', value: apiStatus, inline: true },
                        { name: '📺 管理频道数', value: totalChannels.toString(), inline: true },
                        { name: '📊 总反应次数', value: totalReactions.toString(), inline: true },
                        { name: '🚫 被阻止用户', value: blockedUsersText, inline: true }
                    );

                const row1 = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('bot_settings')
                            .setLabel('机器人设置')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('⚙️'),
                        new ButtonBuilder()
                            .setCustomId('api_settings')
                            .setLabel('AI API配置')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🔧'),
                        new ButtonBuilder()
                            .setCustomId('channel_management')
                            .setLabel('频道管理')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('📺')
                    );
                
                const row2 = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('permission_settings')
                            .setLabel('权限设置')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🔒'),
                        new ButtonBuilder()
                            .setCustomId('blocked_users_management')
                            .setLabel('用户阻止管理')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🚫'),
                        new ButtonBuilder()
                            .setCustomId('channel_stats')
                            .setLabel('频道统计')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('📊')
                    );

                const row3 = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('system_manage')
                            .setLabel('系统管理')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🗑️'),
                        new ButtonBuilder()
                            .setCustomId('help_docs')
                            .setLabel('帮助文档')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('❓')
                    );

                await interaction.reply({
                    embeds: [embed],
                    components: [row1, row2, row3],
                    flags: MessageFlags.Ephemeral
                });
            }
        };

        this.commands.set(panelCommand.name, panelCommand);

        // 用户反应控制命令
        const blockCommand = {
            name: '限制bochi对我做出反应',
            description: '阻止波奇机器人对您的图片做出反应',
            execute: async (interaction) => {
                this.config.botSettings.blockedUsers.add(interaction.user.id);
                await interaction.reply({
                    content: '✅ 已设置成功！波奇不会再对您的图片做出反应。',
                    flags: MessageFlags.Ephemeral
                });
            }
        };

        const unblockCommand = {
            name: '允许bochi对我做出反应',
            description: '允许波奇机器人对您的图片做出反应',
            execute: async (interaction) => {
                this.config.botSettings.blockedUsers.delete(interaction.user.id);
                await interaction.reply({
                    content: '✅ 已设置成功！波奇现在可以对您的图片做出反应了。',
                    flags: MessageFlags.Ephemeral
                });
            }
        };

        // 频道管理命令
        const channelCommand = {
            name: '频道设置',
            description: '设置当前频道的波奇机器人配置',
            execute: async (interaction) => {
                if (!this.checkPermission(interaction)) {
                    return await interaction.reply({
                        content: '❌ 您没有权限使用此命令。请联系管理员。',
                        flags: MessageFlags.Ephemeral
                    });
                }
                await this.showChannelSettings(interaction);
            }
        };

        const statsCommand = {
            name: '频道统计',
            description: '查看所有频道的反应统计信息',
            execute: async (interaction) => {
                if (!this.checkPermission(interaction)) {
                    return await interaction.reply({
                        content: '❌ 您没有权限使用此命令。请联系管理员。',
                        flags: MessageFlags.Ephemeral
                    });
                }
                await this.showChannelStats(interaction);
            }
        };

        this.commands.set(blockCommand.name, blockCommand);
        this.commands.set(unblockCommand.name, unblockCommand);
        this.commands.set(channelCommand.name, channelCommand);
        this.commands.set(statsCommand.name, statsCommand);
    }

    setupEventHandlers() {
        this.client.once(Events.ClientReady, () => {
            console.log(`✅ 波奇机器人已启动! 登录为 ${this.client.user.tag}`);
            console.log(`🔧 权限模式: ${this.fullPermissions ? '完整权限 (可检测图片)' : '基础权限 (仅配置功能)'}`);
            console.log(`🔧 当前配置:`);
            console.log(`   - 图片反应: ${this.config.botSettings.autoReaction ? '开启' : '关闭'}`);
            console.log(`   - AI点评: ${this.config.botSettings.aiComment ? '开启' : '关闭'}`);
            console.log(`   - 标准表情数量: ${this.config.botSettings.reactionEmojis.length}`);
            console.log(`   - 已选服务器表情数量: ${this.config.botSettings.selectedServerEmojis.length}`);
            if (this.fullPermissions) {
                console.log(`🚀 正在监听消息和图片...`);
            } else {
                console.log(`⚠️  图片检测功能需要启用 MESSAGE CONTENT INTENT 权限`);
            }
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

        // 处理消息（图片检测） - 仅在完整权限模式下启用
        if (this.fullPermissions) {
            this.client.on(Events.MessageCreate, async (message) => {
                if (message.author.bot) return;
                
                // 检查用户是否被阻止
                if (this.config.botSettings.blockedUsers.has(message.author.id)) {
                    return; // 被阻止的用户，不处理其消息
                }
                
                if (message.attachments.size > 0) {
                    console.log(`📨 检测到新消息 (来自 ${message.author.username}) - 附件数量: ${message.attachments.size}`);
                    
                    // 收集所有图片附件
                    const imageAttachments = [];
                    for (const attachment of message.attachments.values()) {
                        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                            console.log(`🖼️ 发现图片附件: ${attachment.name} (${attachment.contentType})`);
                            imageAttachments.push(attachment);
                        } else {
                            console.log(`📎 非图片附件: ${attachment.name} (${attachment.contentType || '未知类型'})`);
                        }
                    }
                    
                    // 并发处理所有图片的表情反应（快速响应）
                    if (imageAttachments.length > 0) {
                        const reactionPromises = imageAttachments.map(attachment => 
                            this.handleImageReaction(message, attachment)
                        );
                        
                        // 并发执行所有表情反应，不等待结果
                        Promise.allSettled(reactionPromises).then(results => {
                            const successCount = results.filter(r => r.status === 'fulfilled').length;
                            console.log(`🎨 表情反应完成: ${successCount}/${imageAttachments.length}`);
                        });
                        
                        // AI点评队列处理（异步执行，不阻塞后续消息处理）
                        this.processImageCommentsQueue(message, imageAttachments);
                    }
                }
            });
        }
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
            case 'confirm_emoji_selection':
                if (this.tempSelectedEmojis) {
                    this.config.botSettings.selectedServerEmojis = [...this.tempSelectedEmojis];
                    this.tempSelectedEmojis = null;
                    await interaction.reply({
                        content: `✅ 已确认选择 ${this.config.botSettings.selectedServerEmojis.length} 个服务器表情用于反应！`,
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    await interaction.reply({
                        content: '❌ 请先选择表情。',
                        flags: MessageFlags.Ephemeral
                    });
                }
                break;
            case 'clear_emoji_selection':
                this.config.botSettings.selectedServerEmojis = [];
                this.tempSelectedEmojis = null;
                await interaction.reply({
                    content: '✅ 已清除所有选择的服务器表情。',
                    flags: MessageFlags.Ephemeral
                });
                break;
            case 'get_server_emojis':
                await this.getServerEmojis(interaction);
                break;
            case 'select_server_emojis':
                await this.showServerEmojiSelection(interaction);
                break;
            case 'test_permissions':
                await this.testPermissions(interaction);
                break;
            case 'channel_management':
                await this.showChannelManagement(interaction);
                break;
            case 'blocked_users_management':
                await this.showBlockedUsersManagement(interaction);
                break;
            case 'channel_stats':
                await this.showChannelStats(interaction);
                break;
            case 'system_manage':
                await this.showSystemManage(interaction);
                break;
            case 'help_docs':
                await this.showHelp(interaction);
                break;
            case 'current_channel_settings':
                await this.showChannelSettings(interaction);
                break;
            case 'clear_blocked_users':
                this.config.botSettings.blockedUsers.clear();
                await interaction.update({
                    content: '✅ 已清空所有被阻止的用户列表。',
                    embeds: [],
                    components: []
                });
                break;
            case 'reset_channel_settings':
                this.config.botSettings.channelSettings = {};
                this.config.botSettings.channelStats = {};
                await interaction.update({
                    content: '✅ 已重置所有频道设置和统计数据。',
                    embeds: [],
                    components: []
                });
                break;
            case 'clear_channel_stats':
                await this.clearChannelStats(interaction);
                break;
            case 'clear_blocked_users_data':
                await this.clearBlockedUsersData(interaction);
                break;
            case 'clear_emoji_cache':
                await this.clearEmojiCacheData(interaction);
                break;
            case 'clear_all_data':
                await this.clearAllData(interaction);
                break;
            case 'force_gc':
                await this.forceGarbageCollection(interaction);
                break;
            case 'back_to_main_panel':
                await this.showBochiPanel(interaction);
                break;
        }
        
        // 处理频道特定的按钮（动态ID）
        if (interaction.customId.startsWith('toggle_channel_reaction_')) {
            const channelId = interaction.customId.replace('toggle_channel_reaction_', '');
            if (!this.config.botSettings.channelSettings[channelId]) {
                this.config.botSettings.channelSettings[channelId] = {
                    autoReaction: this.config.botSettings.autoReaction,
                    aiComment: this.config.botSettings.aiComment
                };
            }
            this.config.botSettings.channelSettings[channelId].autoReaction = 
                !this.config.botSettings.channelSettings[channelId].autoReaction;
            await this.showChannelSettings(interaction);
        } else if (interaction.customId.startsWith('toggle_channel_comment_')) {
            const channelId = interaction.customId.replace('toggle_channel_comment_', '');
            if (!this.config.botSettings.channelSettings[channelId]) {
                this.config.botSettings.channelSettings[channelId] = {
                    autoReaction: this.config.botSettings.autoReaction,
                    aiComment: this.config.botSettings.aiComment
                };
            }
            this.config.botSettings.channelSettings[channelId].aiComment = 
                !this.config.botSettings.channelSettings[channelId].aiComment;
            await this.showChannelSettings(interaction);
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
                { name: '🎭 已选服务器表情', value: this.config.botSettings.selectedServerEmojis.length > 0 ? this.config.botSettings.selectedServerEmojis.slice(0, 8).join(' ') + (this.config.botSettings.selectedServerEmojis.length > 8 ? '...' : '') : '无', inline: false }
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
                    .setLabel('扫描服务器表情')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('edit_ai_prompt')
                    .setLabel('编辑AI提示词')
                    .setStyle(ButtonStyle.Success)
            );

        const row3 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('select_server_emojis')
                    .setLabel('选择服务器表情')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(this.config.botSettings.serverEmojisCache.length === 0),
                new ButtonBuilder()
                    .setCustomId('test_permissions')
                    .setLabel(!this.fullPermissions ? '尝试启用完整权限' : '权限测试')
                    .setStyle(!this.fullPermissions ? ButtonStyle.Success : ButtonStyle.Secondary)
            );

        await interaction.update({
            embeds: [embed],
            components: [row1, row2, row3]
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
            case 'emoji_selection_menu':
                // 临时存储选择的表情
                this.tempSelectedEmojis = interaction.values;
                await interaction.reply({
                    content: `✅ 已选择 ${interaction.values.length} 个表情，请点击"确认选择"来应用更改。`,
                    flags: MessageFlags.Ephemeral
                });
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

    async handleImageReaction(message, attachment) {
        const channelId = message.channel.id;
        const channelName = message.channel.name;
        
        // 初始化频道设置（如果不存在）
        if (!this.config.botSettings.channelSettings[channelId]) {
            this.config.botSettings.channelSettings[channelId] = {
                autoReaction: this.config.botSettings.autoReaction,
                aiComment: this.config.botSettings.aiComment
            };
        }
        
        // 初始化频道统计（如果不存在）
        if (!this.config.botSettings.channelStats[channelId]) {
            this.config.botSettings.channelStats[channelId] = {
                name: channelName,
                reactionCount: 0,
                lastUpdate: new Date()
            };
        }
        
        // 使用频道特定设置
        const channelSettings = this.config.botSettings.channelSettings[channelId];
        
        // 自动反应功能
        if (channelSettings.autoReaction) {
            // 合并标准表情和选择的服务器表情
            const allEmojis = [...this.config.botSettings.reactionEmojis, ...this.config.botSettings.selectedServerEmojis];
            
            if (allEmojis.length > 0) {
                const randomEmoji = allEmojis[Math.floor(Math.random() * allEmojis.length)];
                try {
                    await message.react(randomEmoji);
                    console.log(`成功对图片添加反应: ${randomEmoji}`);
                    
                    // 更新频道统计
                    this.config.botSettings.channelStats[channelId].reactionCount++;
                    this.config.botSettings.channelStats[channelId].lastUpdate = new Date();
                    this.config.botSettings.channelStats[channelId].name = channelName;
                    
                    return true;
                } catch (error) {
                    console.error('添加反应失败:', error);
                    // 如果是自定义表情失败，尝试使用标准表情
                    if (this.config.botSettings.reactionEmojis.length > 0) {
                        const fallbackEmoji = this.config.botSettings.reactionEmojis[
                            Math.floor(Math.random() * this.config.botSettings.reactionEmojis.length)
                        ];
                        try {
                            await message.react(fallbackEmoji);
                            console.log(`使用备用表情成功: ${fallbackEmoji}`);
                            
                            // 更新频道统计
                            this.config.botSettings.channelStats[channelId].reactionCount++;
                            this.config.botSettings.channelStats[channelId].lastUpdate = new Date();
                            this.config.botSettings.channelStats[channelId].name = channelName;
                            
                            return true;
                        } catch (fallbackError) {
                            console.error('备用表情也失败:', fallbackError);
                            return false;
                        }
                    }
                    return false;
                }
            }
        }
        return false;
    }

    async processImageCommentsQueue(message, imageAttachments) {
        const channelId = message.channel.id;
        const channelSettings = this.config.botSettings.channelSettings[channelId];
        
        // 检查是否开启AI点评且配置了API
        if (!channelSettings.aiComment) {
            return;
        }
        
        const hasGeminiApi = this.config.apiSettings.useGemini && this.config.apiSettings.geminiApiKeys.length > 0;
        const hasOpenAiApi = !this.config.apiSettings.useGemini && this.config.apiSettings.openaiApiKey;
        
        if (!hasGeminiApi && !hasOpenAiApi) {
            console.log('ℹ️  AI点评功能已开启，但未配置API，跳过点评');
            return;
        }
        
        // 对每张图片进行点评（序列化处理，避免同时调用太多API）
        for (const attachment of imageAttachments) {
            try {
                await message.channel.sendTyping();
                
                let comment = null;
                if (hasGeminiApi) {
                    comment = await this.getGeminiImageComment(attachment.url);
                } else if (hasOpenAiApi) {
                    comment = await this.getOpenAIImageComment(attachment.url);
                }

                if (comment) {
                    await message.reply(comment);
                    console.log(`✅ AI点评成功: ${comment.substring(0, 30)}...`);
                } else {
                    console.log('⚠️  AI点评返回为空，可能是API调用失败');
                }
                
                // 在多图片情况下，每次点评间隔略作停顿，避免频繁调用
                if (imageAttachments.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error('AI点评失败:', error);
                // 静默失败，不向用户显示错误
            }
        }
    }

    // 保留旧的handleImageMessage方法作为备用（如果需要）
    async handleImageMessage(message, attachment) {
        // 这个方法现在主要用于单独处理，多图片应使用上面的新方法
        await this.handleImageReaction(message, attachment);
        await this.processImageCommentsQueue(message, [attachment]);
    }

    async getGeminiImageComment(imageUrl) {
        try {
            // 轮询使用API密钥
            const currentApiKey = this.config.apiSettings.geminiApiKeys[this.config.apiSettings.geminiCurrentIndex];
            this.config.apiSettings.geminiCurrentIndex = 
                (this.config.apiSettings.geminiCurrentIndex + 1) % this.config.apiSettings.geminiApiKeys.length;

            const genAI = new GoogleGenerativeAI(currentApiKey);
            const model = genAI.getGenerativeModel({ 
                model: this.config.apiSettings.geminiModel,
                tools: [{ urlContext: {} }]  // 启用URL Context工具
            });

            const prompt = this.config.botSettings.aiPrompt;

            // 使用URL Context Tool直接处理图片URL，无需下载
            const result = await model.generateContent([
                `${prompt}\n\n请分析这张图片: ${imageUrl}`
            ]);

            console.log('🔄 使用URL Context Tool，零下载流量处理图片');
            return result.response.text();
        } catch (error) {
            console.error('Gemini URL Context调用失败，尝试回退到传统方式:', error);
            // 如果URL Context失败，回退到传统的下载方式
            return await this.getGeminiImageCommentFallback(imageUrl);
        }
    }

    // 保留传统方式作为回退方案
    async getGeminiImageCommentFallback(imageUrl) {
        try {
            console.log('🔄 使用传统下载方式作为回退方案');
            
            // 轮询使用API密钥
            const currentApiKey = this.config.apiSettings.geminiApiKeys[this.config.apiSettings.geminiCurrentIndex];
            
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
            console.error('传统方式也失败:', error);
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

    // 移除默认点评功能 - 现在只依赖真实AI API

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
            
            // 更新缓存，不直接添加到反应列表
            this.config.botSettings.serverEmojisCache = emojiList;

            await interaction.reply({
                content: `✅ 已扫描到 ${emojiList.length} 个服务器表情！\n\n` +
                         `表情预览: ${emojiList.slice(0, 8).join(' ')}` +
                         (emojiList.length > 8 ? ` 等${emojiList.length}个...` : '') + 
                         `\n\n请点击"选择服务器表情"来选择要用于反应的表情。`,
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

    async testPermissions(interaction) {
        if (this.fullPermissions) {
            await interaction.reply({
                content: '✅ 机器人已运行在完整权限模式，图片检测功能正常！',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.reply({
            content: '🔄 尝试启用完整权限...',
            flags: MessageFlags.Ephemeral
        });

        try {
            // 尝试重新创建客户端并启用完整权限
            const oldClient = this.client;
            this.client = this.createClient(true);
            this.fullPermissions = true;
            
            // 重新设置事件监听器
            this.setupEventHandlers();
            
            console.log('🔄 尝试使用完整权限重新连接...');
            
            // 先断开旧连接
            await oldClient.destroy();
            
            // 尝试登录新客户端
            await this.client.login(process.env.DISCORD_TOKEN);
            
            await interaction.editReply({
                content: '✅ 成功启用完整权限！机器人现在可以检测图片了。',
            });
            
        } catch (error) {
            console.log('⚠️  无法启用完整权限:', error.message);
            
            // 回退到基础权限
            this.fullPermissions = false;
            this.client = this.createClient(false);
            this.setupEventHandlers();
            
            try {
                await this.client.login(process.env.DISCORD_TOKEN);
            } catch (loginError) {
                console.error('基础权限登录也失败:', loginError);
            }
            
            await interaction.editReply({
                content: '❌ 无法启用完整权限。请在Discord开发者门户启用 MESSAGE CONTENT INTENT 权限。\n\n' +
                         '操作步骤:\n' +
                         '1. 访问 https://discord.com/developers/applications\n' +
                         '2. 选择您的机器人应用\n' +
                         '3. 进入 "Bot" 页面\n' +
                         '4. 启用 "MESSAGE CONTENT INTENT" 开关\n' +
                         '5. 保存设置并重试'
            });
        }
    }

    async showServerEmojiSelection(interaction) {
        const cachedEmojis = this.config.botSettings.serverEmojisCache;
        
        if (cachedEmojis.length === 0) {
            await interaction.reply({
                content: '❌ 请先扫描服务器表情。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 创建表情选择菜单，最多25个选项
        const maxOptions = Math.min(cachedEmojis.length, 25);
        const emojiOptions = cachedEmojis.slice(0, maxOptions).map((emoji, index) => {
            // 提取表情名称
            const match = emoji.match(/:([^:]+):/);
            const emojiName = match ? match[1] : `emoji_${index}`;
            
            return {
                label: emojiName,
                value: emoji,
                emoji: emoji,
                default: this.config.botSettings.selectedServerEmojis.includes(emoji)
            };
        });

        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🎭 选择服务器表情')
            .setDescription(`从 ${cachedEmojis.length} 个服务器表情中选择要用于反应的表情\n\n` +
                          `当前已选择: ${this.config.botSettings.selectedServerEmojis.length} 个表情`);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('emoji_selection_menu')
            .setPlaceholder('选择要用于反应的表情...')
            .setMinValues(0)
            .setMaxValues(Math.min(maxOptions, 10))
            .addOptions(emojiOptions);

        const actionRow = new ActionRowBuilder().addComponents(selectMenu);

        const confirmButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_emoji_selection')
                    .setLabel('确认选择')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('clear_emoji_selection')
                    .setLabel('清除选择')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.reply({
            embeds: [embed],
            components: [actionRow, confirmButton],
            flags: MessageFlags.Ephemeral
        });
    }

    async showChannelSettings(interaction) {
        const channelId = interaction.channel.id;
        const channelName = interaction.channel.name;
        
        // 初始化频道设置（如果不存在）
        if (!this.config.botSettings.channelSettings[channelId]) {
            this.config.botSettings.channelSettings[channelId] = {
                autoReaction: this.config.botSettings.autoReaction,
                aiComment: this.config.botSettings.aiComment
            };
        }
        
        const channelSettings = this.config.botSettings.channelSettings[channelId];
        
        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('📺 频道设置')
            .setDescription(`当前频道: #${channelName}`)
            .addFields(
                { name: '🎨 图片反应', value: channelSettings.autoReaction ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '💬 AI点评', value: channelSettings.aiComment ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '📊 反应统计', value: this.config.botSettings.channelStats[channelId]?.reactionCount?.toString() || '0', inline: true }
            );

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`toggle_channel_reaction_${channelId}`)
                    .setLabel(channelSettings.autoReaction ? '关闭反应' : '开启反应')
                    .setStyle(channelSettings.autoReaction ? ButtonStyle.Danger : ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`toggle_channel_comment_${channelId}`)
                    .setLabel(channelSettings.aiComment ? '关闭点评' : '开启点评')
                    .setStyle(channelSettings.aiComment ? ButtonStyle.Danger : ButtonStyle.Success)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    async showChannelManagement(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('📺 频道管理')
            .setDescription('管理不同频道的波奇机器人设置');

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('current_channel_settings')
                    .setLabel('当前频道设置')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚙️'),
                new ButtonBuilder()
                    .setCustomId('channel_stats')
                    .setLabel('频道统计')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊'),
                new ButtonBuilder()
                    .setCustomId('reset_channel_settings')
                    .setLabel('重置所有频道设置')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔄')
            );

        await interaction.update({
            embeds: [embed],
            components: [row1]
        });
    }

    async showBlockedUsersManagement(interaction) {
        const blockedUsersList = Array.from(this.config.botSettings.blockedUsers);
        
        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🚫 用户阻止管理')
            .setDescription(`当前有 ${blockedUsersList.length} 位用户被阻止反应`);

        if (blockedUsersList.length > 0) {
            const userMentions = blockedUsersList.slice(0, 20).map(userId => `<@${userId}>`);
            embed.addFields({
                name: '被阻止的用户',
                value: userMentions.join(', ') + (blockedUsersList.length > 20 ? `\n...等${blockedUsersList.length}人` : ''),
                inline: false
            });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('clear_blocked_users')
                    .setLabel('清空阻止列表')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
                    .setDisabled(blockedUsersList.length === 0)
            );

        await interaction.update({
            embeds: [embed],
            components: [row]
        });
    }

    async showChannelStats(interaction) {
        const stats = this.config.botSettings.channelStats;
        
        if (Object.keys(stats).length === 0) {
            await interaction.reply({
                content: '📊 暂无频道统计数据。机器人需要在频道中处理图片后才会有统计信息。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('📊 频道反应统计')
            .setDescription('以下是所有频道的波奇反应统计：');

        // 按反应数量排序
        const sortedChannels = Object.entries(stats)
            .sort(([,a], [,b]) => b.reactionCount - a.reactionCount)
            .slice(0, 10); // 显示前10个频道

        for (const [channelId, channelStat] of sortedChannels) {
            const channel = interaction.guild.channels.cache.get(channelId);
            const channelName = channel ? `#${channel.name}` : channelStat.name;
            const lastUpdate = channelStat.lastUpdate ? 
                new Date(channelStat.lastUpdate).toLocaleDateString('zh-CN') : '未知';
            
            embed.addFields({
                name: channelName,
                value: `反应次数: ${channelStat.reactionCount}\n最后活动: ${lastUpdate}`,
                inline: true
            });
        }

        const totalReactions = Object.values(stats).reduce((sum, stat) => sum + stat.reactionCount, 0);
        embed.setFooter({ text: `总反应次数: ${totalReactions}` });

        const isUpdateCall = interaction.isButton();
        if (isUpdateCall) {
            await interaction.update({
                embeds: [embed],
                components: []
            });
        } else {
            await interaction.reply({
                embeds: [embed],
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

    async showSystemManage(interaction) {
        // 检查权限
        const hasPermission = await this.checkPermission(interaction);
        if (!hasPermission) {
            await interaction.reply({
                content: '❌ 你没有权限使用此功能',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 获取内存使用信息
        const memoryUsage = process.memoryUsage();
        const formatBytes = (bytes) => {
            return (bytes / 1024 / 1024).toFixed(2) + ' MB';
        };

        // 统计数据量
        const channelCount = Object.keys(this.config.botSettings.channelSettings).length;
        const blockedUserCount = this.config.botSettings.blockedUsers.size;
        const totalReactions = Object.values(this.config.botSettings.channelStats)
            .reduce((sum, stats) => sum + (stats.reactionCount || 0), 0);
        const serverEmojisCount = this.config.botSettings.serverEmojisCache.length;

        const embed = new EmbedBuilder()
            .setTitle('🗑️ 系统管理 - 数据清理')
            .setColor(0xFF6B6B)
            .addFields(
                {
                    name: '💾 内存使用情况',
                    value: `**RSS内存**: ${formatBytes(memoryUsage.rss)}\n**堆内存**: ${formatBytes(memoryUsage.heapUsed)}/${formatBytes(memoryUsage.heapTotal)}\n**外部内存**: ${formatBytes(memoryUsage.external)}`,
                    inline: true
                },
                {
                    name: '📊 存储数据统计',
                    value: `**管理频道数**: ${channelCount}\n**被阻止用户**: ${blockedUserCount}\n**总反应次数**: ${totalReactions}\n**缓存表情数**: ${serverEmojisCount}`,
                    inline: true
                },
                {
                    name: '⚠️ 清理操作说明',
                    value: '清理数据将释放内存空间，但会丢失所有历史记录和统计数据。请谨慎操作！',
                    inline: false
                }
            )
            .setFooter({ text: '选择需要清理的数据类型' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('clear_channel_stats')
                    .setLabel('清空频道统计')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊'),
                new ButtonBuilder()
                    .setCustomId('clear_blocked_users_data')
                    .setLabel('清空阻止用户')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('👥'),
                new ButtonBuilder()
                    .setCustomId('clear_emoji_cache')
                    .setLabel('清空表情缓存')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('😀')
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('clear_all_data')
                    .setLabel('清空所有数据')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('💥'),
                new ButtonBuilder()
                    .setCustomId('force_gc')
                    .setLabel('强制垃圾回收')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId('back_to_main_panel')
                    .setLabel('返回主面板')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('↩️')
            );

        await interaction.reply({
            embeds: [embed],
            components: [row, row2],
            flags: MessageFlags.Ephemeral
        });
    }

    async showHelp(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('❓ 波奇机器人帮助文档')
            .setColor(0x00FF00)
            .setDescription('波奇是一个专为图片识别和AI点评设计的Discord机器人')
            .addFields(
                {
                    name: '🎨 主要功能',
                    value: '• 自动检测频道中的图片\n• 智能添加表情反应\n• AI点评系统（支持Gemini和OpenAI）\n• 频道独立设置\n• 用户个人控制',
                    inline: false
                },
                {
                    name: '🔧 基本使用',
                    value: '• `/bochi` - 打开控制面板\n• `/限制bochi对我做出反应` - 屏蔽反应\n• `/允许bochi对我做出反应` - 开启反应\n• `/频道设置` - 当前频道设置\n• `/频道统计` - 查看统计信息',
                    inline: false
                }
            )
            .setFooter({ text: '更多功能请通过控制面板探索' })
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }

    async clearChannelStats(interaction) {
        const hasPermission = await this.checkPermission(interaction);
        if (!hasPermission) {
            await interaction.reply({
                content: '❌ 你没有权限使用此功能',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const beforeCount = Object.keys(this.config.botSettings.channelStats).length;
        this.config.botSettings.channelStats = {};
        
        await interaction.reply({
            content: `✅ 已清空 ${beforeCount} 个频道的统计数据，内存已释放！`,
            flags: MessageFlags.Ephemeral
        });
    }

    async clearBlockedUsersData(interaction) {
        const hasPermission = await this.checkPermission(interaction);
        if (!hasPermission) {
            await interaction.reply({
                content: '❌ 你没有权限使用此功能',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const beforeCount = this.config.botSettings.blockedUsers.size;
        this.config.botSettings.blockedUsers.clear();
        
        await interaction.reply({
            content: `✅ 已清空 ${beforeCount} 个被阻止用户的记录，所有用户现在都可以接收机器人反应！`,
            flags: MessageFlags.Ephemeral
        });
    }

    async clearEmojiCacheData(interaction) {
        const hasPermission = await this.checkPermission(interaction);
        if (!hasPermission) {
            await interaction.reply({
                content: '❌ 你没有权限使用此功能',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const beforeCount = this.config.botSettings.serverEmojisCache.length;
        this.config.botSettings.serverEmojisCache = [];
        this.config.botSettings.customEmojis = [];
        this.config.botSettings.selectedServerEmojis = [];
        
        await interaction.reply({
            content: `✅ 已清空 ${beforeCount} 个缓存表情，表情缓存已重置！下次使用时会重新扫描。`,
            flags: MessageFlags.Ephemeral
        });
    }

    async clearAllData(interaction) {
        const hasPermission = await this.checkPermission(interaction);
        if (!hasPermission) {
            await interaction.reply({
                content: '❌ 你没有权限使用此功能',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const beforeStats = {
            channels: Object.keys(this.config.botSettings.channelStats).length,
            blockedUsers: this.config.botSettings.blockedUsers.size,
            emojis: this.config.botSettings.serverEmojisCache.length,
            totalReactions: Object.values(this.config.botSettings.channelStats)
                .reduce((sum, stats) => sum + (stats.reactionCount || 0), 0)
        };

        this.config.botSettings.channelStats = {};
        this.config.botSettings.blockedUsers.clear();
        this.config.botSettings.serverEmojisCache = [];
        this.config.botSettings.customEmojis = [];
        this.config.botSettings.selectedServerEmojis = [];
        
        await interaction.reply({
            content: `🔥 **全面数据清理完成！**\n` +
                     `• 清空了 ${beforeStats.channels} 个频道统计\n` +
                     `• 清空了 ${beforeStats.blockedUsers} 个阻止用户\n` +
                     `• 清空了 ${beforeStats.emojis} 个缓存表情\n` +
                     `• 总计释放了 ${beforeStats.totalReactions} 条反应记录\n\n` +
                     `✅ 内存大幅释放，机器人已轻装上阵！`,
            flags: MessageFlags.Ephemeral
        });
    }

    async forceGarbageCollection(interaction) {
        const hasPermission = await this.checkPermission(interaction);
        if (!hasPermission) {
            await interaction.reply({
                content: '❌ 你没有权限使用此功能',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const beforeMemory = process.memoryUsage();
        
        if (global.gc) {
            global.gc();
        }
        
        const afterMemory = process.memoryUsage();
        const freedMB = ((beforeMemory.heapUsed - afterMemory.heapUsed) / 1024 / 1024).toFixed(2);
        
        await interaction.reply({
            content: `🔄 **强制垃圾回收完成！**\n` +
                     `• 回收前: ${(beforeMemory.heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
                     `• 回收后: ${(afterMemory.heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
                     `• 释放内存: ${freedMB >= 0 ? '+' : ''}${freedMB} MB\n\n` +
                     `${freedMB > 0 ? '✅ 内存回收成功！' : 'ℹ️ 当前内存使用已优化，无需额外回收。'}`,
            flags: MessageFlags.Ephemeral
        });
    }

    async showBochiPanel(interaction) {
        const panelCommand = this.commands.get('bochi');
        if (panelCommand) {
            await panelCommand.execute(interaction);
        }
    }

    async registerSlashCommands() {
        const commands = [
            {
                name: 'bochi',
                description: '打开波奇机器人配置面板'
            },
            {
                name: '限制bochi对我做出反应',
                description: '阻止波奇机器人对您的图片做出反应'
            },
            {
                name: '允许bochi对我做出反应',
                description: '允许波奇机器人对您的图片做出反应'
            },
            {
                name: '频道设置',
                description: '设置当前频道的波奇机器人配置'
            },
            {
                name: '频道统计',
                description: '查看所有频道的反应统计信息'
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