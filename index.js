const { Client, GatewayIntentBits, Collection, Events, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionResponseType, MessageFlags, PermissionFlagsBits } = require('discord.js');
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
                autoReaction: false,
                aiComment: false,
                reactionEmojis: ['👍', '❤️', '🎨', '✨', '🔥'],
                allowedRoles: [], // 允许的角色ID列表
                allowedUsers: [], // 允许的用户ID列表
                allowedChannels: [], // 允许使用机器人命令的频道ID列表（空表示所有频道）
                aiPrompt: '请用中文对这张图片进行简短的正面点评，语气要友好温馨。点评要真诚且具体，不要过于夸张。请控制在50字以内。', 
                channelSettings: {}, // 按频道存储不同的设置 {channelId: {autoReaction: bool, aiComment: bool, ...}}
                blockedUsers: new Set(), // 不希望被机器人反应的用户ID集合
                channelStats: {}, // 频道统计信息 {channelId: {name: string, reactionCount: number, lastUpdate: Date}}
                
                // 服务器特定配置 {guildId: {settings, emojis, etc}}
                serverConfigs: {} // 每个服务器独立的配置
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

    // 获取或创建服务器配置
    getServerConfig(guildId) {
        if (!this.config.botSettings.serverConfigs[guildId]) {
            this.config.botSettings.serverConfigs[guildId] = {
                customEmojis: [], // 存储服务器自定义表情
                serverEmojisCache: [], // 缓存所有服务器表情
                selectedServerEmojis: [], // 用户选择的服务器表情
                allowedRoles: [], // 存储允许配置的角色ID
                emojiPageIndex: 0, // 表情选择页面索引
                tempSelectedEmojis: [], // 临时选择的表情
                rolePageIndex: 0, // 角色选择页面索引
                rolesCache: [] // 缓存服务器角色列表
            };
        }
        return this.config.botSettings.serverConfigs[guildId];
    }

    // 获取服务器在消息中使用的表情
    getServerEmojisForReaction(guildId) {
        const serverConfig = this.getServerConfig(guildId);
        return [...this.config.botSettings.reactionEmojis, ...serverConfig.selectedServerEmojis];
    }

    // 检查频道权限（用于全员可用的命令）
    checkChannelPermission(interaction) {
        // 如果没有设置任何频道限制，则允许在所有频道使用
        if (this.config.botSettings.allowedChannels.length === 0) {
            return true;
        }
        
        // 检查当前频道是否在允许列表中
        return this.config.botSettings.allowedChannels.includes(interaction.channel.id);
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
                            .setCustomId('channel_allowed_settings')
                            .setLabel('频道权限')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('📋'),
                        new ButtonBuilder()
                            .setCustomId('blocked_users_management')
                            .setLabel('用户阻止管理')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🚫')
                    );

                const row2_2 = new ActionRowBuilder()
                    .addComponents(
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
                    components: [row1, row2, row2_2, row3],
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
                // 检查是否在允许的频道中
                if (!this.checkChannelPermission(interaction)) {
                    const allowedChannels = this.config.botSettings.allowedChannels || [];
                    const channelList = allowedChannels.length > 0 
                        ? allowedChannels.map(id => `<#${id}>`).join('、') 
                        : '无（请联系管理员设置）';
                    
                    return await interaction.reply({
                        content: `❌ **此命令在当前频道不可用**\n\n📌 **允许使用的频道：** ${channelList}\n\nℹ️ 请在上述频道中使用此命令，或联系管理员添加更多允许频道。`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                
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
                // 检查是否在允许的频道中
                if (!this.checkChannelPermission(interaction)) {
                    const allowedChannels = this.config.botSettings.allowedChannels || [];
                    const channelList = allowedChannels.length > 0 
                        ? allowedChannels.map(id => `<#${id}>`).join('、') 
                        : '无（请联系管理员设置）';
                    
                    return await interaction.reply({
                        content: `❌ **此命令在当前频道不可用**\n\n📌 **允许使用的频道：** ${channelList}\n\nℹ️ 请在上述频道中使用此命令，或联系管理员添加更多允许频道。`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                
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
            console.log(`   - 服务器配置数量: ${Object.keys(this.config.botSettings.serverConfigs).length}`);
            if (this.fullPermissions) {
                console.log(`🚀 正在监听消息和图片...`);
            } else {
                console.log(`⚠️  图片检测功能需要启用 MESSAGE CONTENT INTENT 权限`);
            }
            
            // 初始化所有服务器的权限设置
            this.client.guilds.cache.forEach(guild => {
                this.initializePermissions(guild);
            });
            
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
                            // 检查交互是否还有效且未过期
                            const now = Date.now();
                            const interactionTime = interaction.createdTimestamp;
                            const timeDiff = now - interactionTime;
                            
                            // 如果交互超过14分钟（Discord交互15分钟过期），跳过回复
                            if (timeDiff > 14 * 60 * 1000) {
                                console.log('交互已过期，跳过错误回复');
                                return;
                            }
                            
                            // 更加谨慎地检查交互状态
                            if (!interaction.replied && !interaction.deferred) {
                                const reply = { content: '执行命令时发生错误！', flags: MessageFlags.Ephemeral };
                                await interaction.reply(reply);
                            } else {
                                console.log('交互已被处理，跳过错误回复');
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
                    await this.safeReplyError(interaction, '按钮操作时发生错误！');
                }
            }

            // 处理选择菜单交互
            if (interaction.isStringSelectMenu()) {
                try {
                    await this.handleSelectMenuInteraction(interaction);
                } catch (error) {
                    console.error('选择菜单交互错误:', error);
                    await this.safeReplyError(interaction, '菜单操作时发生错误！');
                }
            }

            // 处理模态框交互
            if (interaction.isModalSubmit()) {
                try {
                    await this.handleModalInteraction(interaction);
                } catch (error) {
                    console.error('模态框交互错误:', error);
                    await this.safeReplyError(interaction, '表单提交时发生错误！');
                }
            }
        });

        // 监听角色变化事件，实现动态权限管理
        this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
            await this.handleRoleChange(oldMember, newMember);
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
            case 'channel_allowed_settings':
                await this.showChannelAllowedSettings(interaction);
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
                const guild = interaction.guild;
                if (!guild) {
                    await interaction.reply({
                        content: '❌ 无法获取服务器信息。',
                        flags: MessageFlags.Ephemeral
                    });
                    break;
                }
                const serverConfig = this.getServerConfig(guild.id);
                if (serverConfig.tempSelectedEmojis && serverConfig.tempSelectedEmojis.length > 0) {
                    serverConfig.selectedServerEmojis = [...serverConfig.tempSelectedEmojis];
                    serverConfig.tempSelectedEmojis = [];
                    await interaction.reply({
                        content: `✅ 已确认选择 ${serverConfig.selectedServerEmojis.length} 个服务器表情用于反应！`,
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
                const clearGuild = interaction.guild;
                if (!clearGuild) {
                    await interaction.reply({
                        content: '❌ 无法获取服务器信息。',
                        flags: MessageFlags.Ephemeral
                    });
                    break;
                }
                const clearServerConfig = this.getServerConfig(clearGuild.id);
                clearServerConfig.selectedServerEmojis = [];
                clearServerConfig.tempSelectedEmojis = [];
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
            case 'clear_allowed_channels':
                this.config.botSettings.allowedChannels = [];
                await this.showChannelAllowedSettings(interaction);
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
            case 'emoji_prev_page':
                const prevGuild = interaction.guild;
                if (prevGuild) {
                    const prevServerConfig = this.getServerConfig(prevGuild.id);
                    if (prevServerConfig.emojiPageIndex > 0) {
                        prevServerConfig.emojiPageIndex--;
                    }
                    await this.showServerEmojiSelection(interaction);
                }
                break;
            case 'emoji_next_page':
                const nextGuild = interaction.guild;
                if (nextGuild) {
                    const nextServerConfig = this.getServerConfig(nextGuild.id);
                    const emojisPerPage = 25;
                    const totalPages = Math.ceil(nextServerConfig.serverEmojisCache.length / emojisPerPage);
                    if (nextServerConfig.emojiPageIndex < totalPages - 1) {
                        nextServerConfig.emojiPageIndex++;
                    }
                    await this.showServerEmojiSelection(interaction);
                }
                break;
            case 'emoji_show_selected':
                const showGuild = interaction.guild;
                if (showGuild) {
                    const showServerConfig = this.getServerConfig(showGuild.id);
                    const selectedEmojis = showServerConfig.selectedServerEmojis;
                    if (selectedEmojis.length === 0) {
                        await interaction.reply({
                            content: '❌ 尚未选择任何表情。',
                            flags: MessageFlags.Ephemeral
                        });
                    } else {
                        const emojiPreview = selectedEmojis.slice(0, 20).join(' ') + 
                                           (selectedEmojis.length > 20 ? ` 等${selectedEmojis.length}个...` : '');
                        await interaction.reply({
                            content: `✅ 已选择的服务器表情 (${selectedEmojis.length}个):\n\n${emojiPreview}`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
                break;
            case 'role_prev_page':
                const rolePrevGuild = interaction.guild;
                if (rolePrevGuild) {
                    const rolePrevServerConfig = this.getServerConfig(rolePrevGuild.id);
                    if (rolePrevServerConfig.rolePageIndex > 0) {
                        rolePrevServerConfig.rolePageIndex--;
                    }
                    await this.showPermissionSettings(interaction);
                }
                break;
            case 'role_next_page':
                const roleNextGuild = interaction.guild;
                if (roleNextGuild) {
                    const roleNextServerConfig = this.getServerConfig(roleNextGuild.id);
                    const rolesPerPage = 25;
                    const totalRolePages = Math.ceil(roleNextServerConfig.rolesCache.length / rolesPerPage);
                    if (roleNextServerConfig.rolePageIndex < totalRolePages - 1) {
                        roleNextServerConfig.rolePageIndex++;
                    }
                    await this.showPermissionSettings(interaction);
                }
                break;
            case 'role_refresh_list':
                const roleRefreshGuild = interaction.guild;
                if (roleRefreshGuild) {
                    const roleRefreshServerConfig = this.getServerConfig(roleRefreshGuild.id);
                    // 清空缓存，重新获取角色列表
                    roleRefreshServerConfig.rolesCache = [];
                    roleRefreshServerConfig.rolePageIndex = 0;
                    await this.showPermissionSettings(interaction);
                }
                break;
            case 'add_user_permission':
                await this.showAddUserModal(interaction);
                break;
            case 'remove_user_permission':
                await this.showRemoveUserModal(interaction);
                break;
            case 'list_all_users':
                await this.showAllAuthorizedUsers(interaction);
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

    async showAddUserModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('add_user_modal')
            .setTitle('添加用户权限');

        const userIdInput = new TextInputBuilder()
            .setCustomId('user_id_input')
            .setLabel('用户ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('请输入用户的Discord ID (例如: 123456789012345678)')
            .setRequired(true);

        const userReasonInput = new TextInputBuilder()
            .setCustomId('user_reason_input')
            .setLabel('添加原因 (可选)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例如: 临时管理员、协助者等')
            .setRequired(false);

        const firstActionRow = new ActionRowBuilder().addComponents(userIdInput);
        const secondActionRow = new ActionRowBuilder().addComponents(userReasonInput);

        modal.addComponents(firstActionRow, secondActionRow);
        await interaction.showModal(modal);
    }

    async showRemoveUserModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('remove_user_modal')
            .setTitle('移除用户权限');

        const userIdInput = new TextInputBuilder()
            .setCustomId('remove_user_id_input')
            .setLabel('用户ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('请输入要移除权限的用户Discord ID')
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(userIdInput);
        modal.addComponents(firstActionRow);
        await interaction.showModal(modal);
    }

    async showAllAuthorizedUsers(interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: '❌ 无法获取服务器信息。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const allowedUsers = this.config.botSettings.allowedUsers;
        
        if (allowedUsers.length === 0) {
            await interaction.reply({
                content: '📋 **当前没有单独授权的用户**\n\n所有管理权限均通过角色管理。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const userInfoList = await Promise.all(
            allowedUsers.map(async (userId) => {
                try {
                    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
                    return `👤 **${member.user.username}** (${member.user.tag})\n   └ ID: \`${userId}\``;
                } catch (error) {
                    return `❓ **未知用户**\n   └ ID: \`${userId}\` (用户可能已离开服务器)`;
                }
            })
        );

        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('👥 已授权用户列表')
            .setDescription(userInfoList.join('\n\n'))
            .addFields(
                { name: '📊 统计', value: `共 ${allowedUsers.length} 个用户`, inline: true },
                { name: '💡 提示', value: '使用"移除用户权限"按钮来撤销用户的管理权限', inline: true }
            )
            .setTimestamp();

        const backButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('permission_settings')
                    .setLabel('返回权限设置')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔙')
            );

        await interaction.reply({
            embeds: [embed],
            components: [backButton],
            flags: MessageFlags.Ephemeral
        });
    }

    async showBotSettings(interaction) {
        const guild = interaction.guild;
        const guildId = guild?.id;
        
        // 获取当前服务器的表情配置
        const serverConfig = guildId ? this.getServerConfig(guildId) : null;
        const selectedServerEmojis = serverConfig ? serverConfig.selectedServerEmojis : [];
        const cachedEmojisCount = serverConfig ? serverConfig.serverEmojisCache.length : 0;
        
        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🐕 机器人设置')
            .setDescription(guild ? `当前服务器: ${guild.name}` : '未知服务器')
            .addFields(
                { name: '🎨 自动图片反应', value: this.config.botSettings.autoReaction ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '💬 AI图片点评', value: this.config.botSettings.aiComment ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '😊 标准表情', value: this.config.botSettings.reactionEmojis.join(' '), inline: false },
                { name: '🎭 本服务器已选表情', value: selectedServerEmojis.length > 0 ? selectedServerEmojis.slice(0, 8).join(' ') + (selectedServerEmojis.length > 8 ? `等${selectedServerEmojis.length}个...` : '') : '无', inline: false },
                { name: '📊 本服务器表情缓存', value: `${cachedEmojisCount} 个`, inline: true }
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
                    .setDisabled(cachedEmojisCount === 0),
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
        if (!guild) {
            await interaction.update({
                content: '❌ 无法获取服务器信息。',
                embeds: [],
                components: []
            });
            return;
        }

        const serverConfig = this.getServerConfig(guild.id);
        
        // 获取允许的角色信息
        const allowedRoles = this.config.botSettings.allowedRoles
            .map(roleId => {
                const role = guild.roles.cache.get(roleId);
                return role ? `${role.name}` : '未知角色';
            })
            .join('、') || '无';

        // 获取允许的用户信息
        const allowedUsers = this.config.botSettings.allowedUsers
            .map(userId => {
                const member = guild.members.cache.get(userId);
                return member ? `${member.user.username}` : `用户ID:${userId}`;
            })
            .slice(0, 10) // 最多显示10个用户
            .join('、') || '无';
        
        const userCountText = this.config.botSettings.allowedUsers.length > 10 
            ? `${allowedUsers}等${this.config.botSettings.allowedUsers.length}人` 
            : allowedUsers;

        // 获取所有可选择的角色并缓存（确保"BOT维护员"角色默认在选择状态）
        const allRoles = guild.roles.cache
            .filter(role => !role.managed && role.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(role => role);

        // 确保BOT维护员角色默认被选中
        const botMaintainerRole = allRoles.find(role => 
            role.name === 'BOT维护员' || role.name.includes('维护员') || role.name.includes('BOT')
        );
        if (botMaintainerRole && !this.config.botSettings.allowedRoles.includes(botMaintainerRole.id)) {
            this.config.botSettings.allowedRoles.push(botMaintainerRole.id);
        }

        if (serverConfig.rolesCache.length === 0 && allRoles.length > 0) {
            serverConfig.rolesCache = allRoles;
        }

        const rolesPerPage = 25;
        const pageIndex = serverConfig.rolePageIndex || 0;
        const totalPages = Math.ceil(serverConfig.rolesCache.length / rolesPerPage);
        const startIndex = pageIndex * rolesPerPage;
        const endIndex = Math.min(startIndex + rolesPerPage, serverConfig.rolesCache.length);
        
        const currentPageRoles = serverConfig.rolesCache.slice(startIndex, endIndex);

        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🔒 权限设置')
            .addFields(
                { name: '👥 允许的角色', value: allowedRoles, inline: false },
                { name: '👤 允许的用户', value: userCountText, inline: false },
                { name: '📊 角色信息', value: `总角色数: ${serverConfig.rolesCache.length}\n当前页面: ${pageIndex + 1}/${totalPages} (显示 ${startIndex + 1}-${endIndex})`, inline: false },
                { name: '💡 说明', value: '拥有指定角色的用户或被单独授权的用户可以使用机器人配置功能', inline: false }
            );

        const components = [];

        // 用户管理按钮行
        const userManagementRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('add_user_permission')
                    .setLabel('添加用户权限')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👤'),
                new ButtonBuilder()
                    .setCustomId('remove_user_permission')
                    .setLabel('移除用户权限')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId('list_all_users')
                    .setLabel('查看所有授权用户')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );
        components.push(userManagementRow);

        // 角色选择菜单
        if (currentPageRoles.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_allowed_roles')
                .setPlaceholder('选择允许的角色（可多选）')
                .setMaxValues(Math.min(currentPageRoles.length, 10))
                .addOptions(currentPageRoles.map(role => ({
                    label: role.name,
                    value: role.id,
                    description: `成员数: ${role.members.size} | 位置: ${role.position}`,
                    default: this.config.botSettings.allowedRoles.includes(role.id)
                })));

            components.push(new ActionRowBuilder().addComponents(selectMenu));

            // 分页按钮
            if (totalPages > 1) {
                const navigationRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('role_prev_page')
                            .setLabel('上一页')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(pageIndex === 0),
                        new ButtonBuilder()
                            .setCustomId('role_next_page')
                            .setLabel('下一页')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(pageIndex >= totalPages - 1),
                        new ButtonBuilder()
                            .setCustomId('role_refresh_list')
                            .setLabel('刷新角色列表')
                            .setStyle(ButtonStyle.Primary)
                    );
                components.push(navigationRow);
            }
        }

        try {
            // 检查交互是否仍然有效
            if (!interaction.replied && !interaction.deferred) {
                await interaction.update({
                    embeds: [embed],
                    components: components
                });
            } else {
                console.log('权限设置交互已过期或已处理，跳过更新');
            }
        } catch (error) {
            console.error('更新权限设置时出错:', error.message);
        }
    }

    async showChannelAllowedSettings(interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.update({
                content: '❌ 无法获取服务器信息。',
                embeds: [],
                components: []
            });
            return;
        }

        const allowedChannels = this.config.botSettings.allowedChannels
            .map(channelId => {
                const channel = guild.channels.cache.get(channelId);
                return channel ? `#${channel.name}` : '未知频道';
            })
            .join(', ') || '所有频道';

        // 获取所有可选择的文字频道
        const allChannels = guild.channels.cache
            .filter(channel => channel.type === 0) // 只显示文字频道
            .sort((a, b) => a.position - b.position)
            .map(channel => channel);

        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('📋 频道权限设置')
            .addFields(
                { name: '📝 允许的频道', value: allowedChannels, inline: false },
                { name: '📊 频道信息', value: `总频道数: ${allChannels.length}`, inline: false },
                { name: '💡 说明', value: '设置允许使用机器人命令的频道，空表示所有频道都可以使用', inline: false }
            );

        const components = [];

        if (allChannels.length > 0) {
            // 最多显示25个频道
            const channelsToShow = allChannels.slice(0, 25);
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_allowed_channels')
                .setPlaceholder('选择允许的频道')
                .setMaxValues(Math.min(channelsToShow.length, 10))
                .addOptions(channelsToShow.map(channel => ({
                    label: `#${channel.name}`,
                    value: channel.id,
                    description: `类型: 文字频道`,
                    default: this.config.botSettings.allowedChannels.includes(channel.id)
                })));

            components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        // 清空按钮
        const clearRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('clear_allowed_channels')
                    .setLabel('清空频道限制')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );
        components.push(clearRow);

        await interaction.update({
            embeds: [embed],
            components: components
        });
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
            case 'select_allowed_channels':
                this.config.botSettings.allowedChannels = interaction.values;
                await this.showChannelAllowedSettings(interaction);
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
                const emojiGuild = interaction.guild;
                if (!emojiGuild) {
                    await interaction.reply({
                        content: '❌ 无法获取服务器信息。',
                        flags: MessageFlags.Ephemeral
                    });
                    break;
                }
                const emojiServerConfig = this.getServerConfig(emojiGuild.id);
                // 临时存储选择的表情到服务器配置中
                emojiServerConfig.tempSelectedEmojis = interaction.values;
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

            case 'add_user_modal':
                const userId = interaction.fields.getTextInputValue('user_id_input').trim();
                const reason = interaction.fields.getTextInputValue('user_reason_input') || '未提供原因';
                
                // 验证用户ID格式
                if (!/^\d{17,19}$/.test(userId)) {
                    await interaction.reply({
                        content: '❌ 无效的用户ID格式！用户ID应该是17-19位数字。',
                        flags: MessageFlags.Ephemeral
                    });
                    break;
                }

                // 检查用户是否已存在
                if (this.config.botSettings.allowedUsers.includes(userId)) {
                    await interaction.reply({
                        content: '⚠️ 该用户已经拥有管理权限！',
                        flags: MessageFlags.Ephemeral
                    });
                    break;
                }

                // 尝试获取用户信息
                try {
                    const guild = interaction.guild;
                    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
                    
                    // 添加用户到允许列表
                    this.config.botSettings.allowedUsers.push(userId);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('✅ 用户权限添加成功')
                        .addFields(
                            { name: '👤 用户', value: `${member.user.username} (${member.user.tag})`, inline: true },
                            { name: '🆔 用户ID', value: `\`${userId}\``, inline: true },
                            { name: '📝 添加原因', value: reason, inline: false },
                            { name: '⏰ 添加时间', value: new Date().toLocaleString('zh-CN'), inline: true }
                        );

                    await interaction.reply({
                        embeds: [embed],
                        flags: MessageFlags.Ephemeral
                    });

                    console.log(`✅ 已添加用户 ${member.user.username} (${userId}) 到管理员列表`);
                } catch (error) {
                    // 用户不在服务器中，但仍然添加到列表
                    this.config.botSettings.allowedUsers.push(userId);
                    
                    await interaction.reply({
                        content: `✅ **用户权限添加成功**\n\n👤 **用户ID**: \`${userId}\`\n📝 **添加原因**: ${reason}\n\n⚠️ 注意：无法获取用户信息，该用户可能不在此服务器中，但权限已成功添加。`,
                        flags: MessageFlags.Ephemeral
                    });

                    console.log(`✅ 已添加用户ID ${userId} 到管理员列表（用户不在服务器中）`);
                }
                break;

            case 'remove_user_modal':
                const removeUserId = interaction.fields.getTextInputValue('remove_user_id_input').trim();
                
                // 验证用户ID格式
                if (!/^\d{17,19}$/.test(removeUserId)) {
                    await interaction.reply({
                        content: '❌ 无效的用户ID格式！用户ID应该是17-19位数字。',
                        flags: MessageFlags.Ephemeral
                    });
                    break;
                }

                // 检查用户是否在允许列表中
                const userIndex = this.config.botSettings.allowedUsers.indexOf(removeUserId);
                if (userIndex === -1) {
                    await interaction.reply({
                        content: '⚠️ 该用户不在管理权限列表中！',
                        flags: MessageFlags.Ephemeral
                    });
                    break;
                }

                // 移除用户
                this.config.botSettings.allowedUsers.splice(userIndex, 1);
                
                // 尝试获取用户信息以显示
                try {
                    const guild = interaction.guild;
                    const member = guild.members.cache.get(removeUserId) || await guild.members.fetch(removeUserId);
                    
                    await interaction.reply({
                        content: `✅ **用户权限移除成功**\n\n👤 **用户**: ${member.user.username} (${member.user.tag})\n🆔 **用户ID**: \`${removeUserId}\`\n⏰ **移除时间**: ${new Date().toLocaleString('zh-CN')}`,
                        flags: MessageFlags.Ephemeral
                    });

                    console.log(`✅ 已从管理员列表移除用户 ${member.user.username} (${removeUserId})`);
                } catch (error) {
                    await interaction.reply({
                        content: `✅ **用户权限移除成功**\n\n🆔 **用户ID**: \`${removeUserId}\`\n⏰ **移除时间**: ${new Date().toLocaleString('zh-CN')}`,
                        flags: MessageFlags.Ephemeral
                    });

                    console.log(`✅ 已从管理员列表移除用户ID ${removeUserId}`);
                }
                break;
        }
    }

    async handleImageReaction(message, attachment) {
        const channelId = message.channel.id;
        const channelName = message.channel.name;
        
        // 初始化频道统计（如果不存在）
        if (!this.config.botSettings.channelStats[channelId]) {
            this.config.botSettings.channelStats[channelId] = {
                name: channelName,
                reactionCount: 0,
                lastUpdate: new Date()
            };
        }
        
        // 获取有效的反应设置：频道设置优先，否则使用全局设置
        const channelSettings = this.config.botSettings.channelSettings[channelId];
        const shouldReact = channelSettings && channelSettings.hasOwnProperty('autoReaction') 
            ? channelSettings.autoReaction 
            : this.config.botSettings.autoReaction;
        
        // 自动反应功能
        if (shouldReact) {
            // 获取服务器特定的表情配置
            const guildId = message.guild?.id;
            const serverEmojis = guildId ? this.getServerEmojisForReaction(guildId) : this.config.botSettings.reactionEmojis;
            
            // 合并标准表情和选择的服务器表情
            const allEmojis = serverEmojis;
            
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
        
        // 获取有效的AI点评设置：频道设置优先，否则使用全局设置
        const shouldComment = channelSettings && channelSettings.hasOwnProperty('aiComment') 
            ? channelSettings.aiComment 
            : this.config.botSettings.aiComment;
        
        // 检查是否开启AI点评且配置了API
        if (!shouldComment) {
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
            
            // 获取服务器配置并更新该服务器的表情缓存
            const serverConfig = this.getServerConfig(guild.id);
            serverConfig.serverEmojisCache = emojiList;
            serverConfig.emojiPageIndex = 0; // 重置分页索引

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
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: '❌ 无法获取服务器信息。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const serverConfig = this.getServerConfig(guild.id);
        const cachedEmojis = serverConfig.serverEmojisCache;
        
        if (cachedEmojis.length === 0) {
            await interaction.reply({
                content: '❌ 请先扫描服务器表情。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 分页设置
        const emojisPerPage = 25;
        const pageIndex = serverConfig.emojiPageIndex || 0;
        const totalPages = Math.ceil(cachedEmojis.length / emojisPerPage);
        const startIndex = pageIndex * emojisPerPage;
        const endIndex = Math.min(startIndex + emojisPerPage, cachedEmojis.length);
        
        // 获取当前页的表情
        const currentPageEmojis = cachedEmojis.slice(startIndex, endIndex);
        
        if (currentPageEmojis.length === 0) {
            await interaction.reply({
                content: '❌ 当前页面没有表情。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const emojiOptions = currentPageEmojis.map((emoji, index) => {
            // 提取表情名称
            const match = emoji.match(/:([^:]+):/);
            const emojiName = match ? match[1] : `emoji_${startIndex + index}`;
            
            return {
                label: emojiName,
                value: emoji,
                emoji: emoji,
                default: serverConfig.selectedServerEmojis.includes(emoji)
            };
        });

        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('🎭 选择服务器表情')
            .setDescription(`从 ${cachedEmojis.length} 个服务器表情中选择要用于反应的表情\n\n` +
                          `当前页面: ${pageIndex + 1}/${totalPages} (显示 ${startIndex + 1}-${endIndex})\n` +
                          `当前已选择: ${serverConfig.selectedServerEmojis.length} 个表情`);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('emoji_selection_menu')
            .setPlaceholder('选择要用于反应的表情...')
            .setMinValues(0)
            .setMaxValues(Math.min(currentPageEmojis.length, 10))
            .addOptions(emojiOptions);

        const actionRow = new ActionRowBuilder().addComponents(selectMenu);

        // 分页按钮
        const navigationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('emoji_prev_page')
                    .setLabel('上一页')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageIndex === 0),
                new ButtonBuilder()
                    .setCustomId('emoji_next_page')
                    .setLabel('下一页')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageIndex >= totalPages - 1),
                new ButtonBuilder()
                    .setCustomId('emoji_show_selected')
                    .setLabel(`查看已选择(${serverConfig.selectedServerEmojis.length})`)
                    .setStyle(ButtonStyle.Primary)
            );

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
            components: [actionRow, navigationRow, confirmButton],
            flags: MessageFlags.Ephemeral
        });
    }

    async showChannelSettings(interaction) {
        if (!interaction.channel) {
            await interaction.reply({
                content: '❌ 无法获取频道信息。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        
        const channelId = interaction.channel.id;
        const channelName = interaction.channel.name;
        
        // 获取有效设置（频道设置优先，否则使用全局设置）
        const channelSettings = this.config.botSettings.channelSettings[channelId];
        const effectiveAutoReaction = channelSettings && channelSettings.hasOwnProperty('autoReaction') 
            ? channelSettings.autoReaction 
            : this.config.botSettings.autoReaction;
        const effectiveAiComment = channelSettings && channelSettings.hasOwnProperty('aiComment') 
            ? channelSettings.aiComment 
            : this.config.botSettings.aiComment;
        
        // 判断是否有独立设置
        const hasIndependentSettings = channelSettings && 
            (channelSettings.hasOwnProperty('autoReaction') || channelSettings.hasOwnProperty('aiComment'));
        
        const embed = new EmbedBuilder()
            .setColor('#FFB6C1')
            .setTitle('📺 频道设置')
            .setDescription(`当前频道: #${channelName}${hasIndependentSettings ? '\n🔧 此频道有独立设置' : '\n📋 此频道使用全局设置'}`)
            .addFields(
                { name: '🎨 图片反应', value: effectiveAutoReaction ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '💬 AI点评', value: effectiveAiComment ? '✅ 开启' : '❌ 关闭', inline: true },
                { name: '📊 反应统计', value: this.config.botSettings.channelStats[channelId]?.reactionCount?.toString() || '0', inline: true }
            );

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`toggle_channel_reaction_${channelId}`)
                    .setLabel(effectiveAutoReaction ? '关闭反应' : '开启反应')
                    .setStyle(effectiveAutoReaction ? ButtonStyle.Danger : ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`toggle_channel_comment_${channelId}`)
                    .setLabel(effectiveAiComment ? '关闭点评' : '开启点评')
                    .setStyle(effectiveAiComment ? ButtonStyle.Danger : ButtonStyle.Success)
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

    // 检查用户是否有管理员权限（可以使用所有命令）
    checkPermission(interaction) {
        const member = interaction.member;
        if (!member) {
            console.log(`❌ 权限检查失败: 无法获取成员信息`);
            return false;
        }
        
        // 获取用户的所有角色信息（调试用）
        const userRoles = member.roles.cache.map(role => role.name);
        console.log(`🔍 权限检查 - 用户: ${member.user.username} (${member.id})`);
        console.log(`👥 用户的所有角色: [${userRoles.join(', ')}]`);
        
        // 检查是否是全局管理员（优先级最高，跨所有服务器有效）
        const globalAdminId = process.env.BOCHI_GLOBAL_ADMIN_ID;
        if (globalAdminId && member.id === globalAdminId) {
            console.log(`🌟 权限通过: 用户是全局管理员 (跨服务器权限)`);
            return true;
        } else if (globalAdminId) {
            console.log(`🔍 全局管理员检查: 当前用户 ${member.id} != 全局管理员 ${globalAdminId}`);
        } else {
            console.log(`⚠️  未设置全局管理员环境变量 BOCHI_GLOBAL_ADMIN_ID`);
        }
        
        // 检查是否是服务器主（拥有者）
        if (member.guild.ownerId === member.id) {
            console.log(`✅ 权限通过: 用户是服务器主`);
            return true;
        }
        
        // 检查是否有"BOT维护员"角色
        const possibleNames = ['BOT维护员', 'Bot维护员', 'bot维护员', 'BOT 维护员', 'Bot 维护员'];
        let botMaintainerRole = null;
        
        console.log(`🔍 寻找BOT维护员角色，可能的名称: [${possibleNames.join(', ')}]`);
        
        for (const roleName of possibleNames) {
            botMaintainerRole = member.guild.roles.cache.find(role => role.name === roleName);
            if (botMaintainerRole) {
                console.log(`✅ 找到BOT维护员角色: "${roleName}" (ID: ${botMaintainerRole.id})`);
                break;
            }
        }
        
        // 如果精确匹配失败，尝试包含匹配
        if (!botMaintainerRole) {
            console.log(`🔍 精确匹配失败，尝试包含匹配...`);
            const allRoles = member.guild.roles.cache.map(role => `"${role.name}"`);
            console.log(`📋 服务器所有角色: [${allRoles.join(', ')}]`);
            
            botMaintainerRole = member.guild.roles.cache.find(role => 
                role.name.includes('维护员') || role.name.includes('BOT') || role.name.toLowerCase().includes('maintainer')
            );
            
            if (botMaintainerRole) {
                console.log(`✅ 包含匹配找到BOT维护员角色: "${botMaintainerRole.name}" (ID: ${botMaintainerRole.id})`);
            } else {
                console.log(`❌ 未找到任何BOT维护员相关角色`);
            }
        }
        
        if (botMaintainerRole && member.roles.cache.has(botMaintainerRole.id)) {
            console.log(`✅ 权限通过: 用户拥有BOT维护员角色 "${botMaintainerRole.name}"`);
            return true;
        } else if (botMaintainerRole) {
            console.log(`❌ 用户虽然服务器有BOT维护员角色 "${botMaintainerRole.name}"，但用户未拥有此角色`);
        }
        
        // 检查用户是否拥有手动添加的指定角色
        console.log(`🔍 检查手动添加的角色权限，允许的角色ID: [${this.config.botSettings.allowedRoles.join(', ')}]`);
        const hasAllowedRole = this.config.botSettings.allowedRoles.some(roleId => {
            const hasRole = member.roles.cache.has(roleId);
            if (hasRole) {
                const roleName = member.guild.roles.cache.get(roleId)?.name || '未知角色';
                console.log(`✅ 用户拥有允许的角色: "${roleName}" (ID: ${roleId})`);
            }
            return hasRole;
        });
        
        // 检查用户是否在允许的用户列表中
        console.log(`🔍 检查个人用户权限，允许的用户ID: [${this.config.botSettings.allowedUsers.join(', ')}]`);
        const isAllowedUser = this.config.botSettings.allowedUsers.includes(member.id);
        if (isAllowedUser) {
            console.log(`✅ 权限通过: 用户在个人授权列表中`);
        }
        
        const finalResult = hasAllowedRole || isAllowedUser;
        console.log(`🎯 最终权限结果: ${finalResult ? '✅ 通过' : '❌ 拒绝'} (角色权限: ${hasAllowedRole}, 个人权限: ${isAllowedUser})`);
        
        return finalResult;
    }
    
    // 检查普通用户是否可以在当前频道使用命令
    checkChannelPermission(interaction) {
        const member = interaction.member;
        if (!member) return false;
        
        // 管理员可以在任何频道使用命令
        if (this.checkPermission(interaction)) {
            return true;
        }
        
        // 检查当前频道是否在允许列表中
        const channelId = interaction.channelId;
        const allowedChannels = this.config.botSettings.allowedChannels || [];
        
        // 如果没有设置允许频道，则普通用户不能使用命令
        if (allowedChannels.length === 0) {
            return false;
        }
        
        return allowedChannels.includes(channelId);
    }

    // 安全地回复错误消息，避免"Unknown interaction"错误
    async safeReplyError(interaction, message) {
        try {
            // 检查交互是否还有效且未过期
            const now = Date.now();
            const interactionTime = interaction.createdTimestamp;
            const timeDiff = now - interactionTime;
            
            // 如果交互超过14分钟（Discord交互15分钟过期），跳过回复
            if (timeDiff > 14 * 60 * 1000) {
                console.log('交互已过期，跳过错误回复');
                return;
            }
            
            // 更加谨慎地检查交互状态
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: message,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                console.log('交互已被处理，跳过错误回复');
            }
        } catch (error) {
            console.error('安全错误回复失败:', error.message);
        }
    }

    // 同步BOT维护员角色的用户到管理员列表
    async syncBotMaintainerPermissions(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const guild = interaction.guild;
            
            // 查找BOT维护员角色
            const botMaintainerRole = guild.roles.cache.find(role => role.name === 'BOT维护员');
            
            if (!botMaintainerRole) {
                return await interaction.editReply({
                    content: '❌ 在此服务器中未找到"BOT维护员"角色。请检查角色名称是否正确。'
                });
            }
            
            // 获取所有拥有BOT维护员角色的成员
            const maintainerMembers = botMaintainerRole.members;
            
            if (maintainerMembers.size === 0) {
                return await interaction.editReply({
                    content: '⚠️ 没有用户拥有"BOT维护员"角色。'
                });
            }
            
            // 添加这些用户到管理员角色列表中
            const newAdmins = [];
            maintainerMembers.forEach(member => {
                if (!this.config.botSettings.allowedRoles.includes(member.user.id)) {
                    this.config.botSettings.allowedRoles.push(member.user.id);
                    newAdmins.push(member.user.username);
                }
            });
            
            // 创建报告
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ 管理员权限同步完成')
                .addFields(
                    {
                        name: '🎯 发现的BOT维护员',
                        value: maintainerMembers.map(m => `<@${m.user.id}>`).join('\n') || '无',
                        inline: false
                    },
                    {
                        name: '➕ 新增的管理员',
                        value: newAdmins.join('\n') || '无（所有用户已是管理员）',
                        inline: false
                    },
                    {
                        name: '📊 当前管理员总数',
                        value: this.config.botSettings.allowedRoles.length.toString(),
                        inline: true
                    }
                )
                .setFooter({ text: '现在这些用户可以使用所有机器人管理功能' });
            
            await interaction.editReply({
                embeds: [embed]
            });
            
        } catch (error) {
            console.error('同步管理员权限时出错:', error);
            await this.safeReplyError(interaction, '同步管理员权限时发生错误！');
        }
    }

    // 显示角色调试信息
    async showRoleDebugInfo(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const guild = interaction.guild;
            const member = interaction.member;
            
            // 获取所有角色
            const allRoles = guild.roles.cache.map(role => `${role.name} (${role.id})`);
            
            // 查找BOT维护员角色
            const botMaintainerRole = guild.roles.cache.find(role => role.name === 'BOT维护员');
            
            // 获取用户的角色
            const userRoles = member.roles.cache.map(role => `${role.name} (${role.id})`);
            
            // 获取配置的管理员角色
            const configuredAdmins = this.config.botSettings.allowedRoles;
            
            const embed = new EmbedBuilder()
                .setColor('#FFB6C1')
                .setTitle('🔍 角色调试信息')
                .addFields(
                    {
                        name: '👤 当前用户信息',
                        value: `用户: ${member.user.username}\nID: ${member.id}\n是否为服务器所有者: ${guild.ownerId === member.id ? '是' : '否'}`,
                        inline: false
                    },
                    {
                        name: '🎭 用户拥有的角色',
                        value: userRoles.join('\n') || '无角色',
                        inline: false
                    },
                    {
                        name: '🤖 BOT维护员角色状态',
                        value: botMaintainerRole ? 
                            `✅ 找到角色\n角色ID: ${botMaintainerRole.id}\n拥有此角色的用户数: ${botMaintainerRole.members.size}\n当前用户是否拥有: ${member.roles.cache.has(botMaintainerRole.id) ? '是' : '否'}` :
                            '❌ 未找到"BOT维护员"角色',
                        inline: false
                    },
                    {
                        name: '⚙️ 配置的管理员ID列表',
                        value: configuredAdmins.length > 0 ? configuredAdmins.join('\n') : '无',
                        inline: false
                    },
                    {
                        name: '🔐 权限检查结果',
                        value: this.checkPermission(interaction) ? '✅ 有管理员权限' : '❌ 无管理员权限',
                        inline: false
                    }
                );
            
            // 只显示前10个角色，避免消息过长
            if (allRoles.length > 10) {
                embed.addFields({
                    name: '🎭 服务器所有角色 (前10个)',
                    value: allRoles.slice(0, 10).join('\n') + `\n...还有${allRoles.length - 10}个角色`,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '🎭 服务器所有角色',
                    value: allRoles.join('\n') || '无角色',
                    inline: false
                });
            }
            
            await interaction.editReply({
                embeds: [embed]
            });
            
        } catch (error) {
            console.error('显示角色调试信息时出错:', error);
            await this.safeReplyError(interaction, '获取角色调试信息时发生错误！');
        }
    }

    // 处理角色变化事件，实现动态权限管理
    async handleRoleChange(oldMember, newMember) {
        try {
            // 检查BOT维护员角色的变化
            const maintainerRoleName = 'BOT维护员';
            const maintainerRole = newMember.guild.roles.cache.find(role => role.name === maintainerRoleName);
            
            if (!maintainerRole) return; // 如果没有BOT维护员角色，不处理
            
            const hadRole = oldMember.roles.cache.has(maintainerRole.id);
            const hasRole = newMember.roles.cache.has(maintainerRole.id);
            
            // 角色状态没有变化，不处理
            if (hadRole === hasRole) return;
            
            // 角色状态发生变化
            if (hasRole && !hadRole) {
                // 用户获得了BOT维护员角色
                console.log(`🔑 用户 ${newMember.user.username} 获得了 BOT维护员 角色`);
                await this.updateUserCommandPermissions(newMember, true);
            } else if (hadRole && !hasRole) {
                // 用户失去了BOT维护员角色
                console.log(`🔒 用户 ${newMember.user.username} 失去了 BOT维护员 角色`);
                await this.updateUserCommandPermissions(newMember, false);
            }
        } catch (error) {
            console.error('处理角色变化时出错:', error.message);
        }
    }

    // 更新用户的命令权限
    async updateUserCommandPermissions(member, hasAdminAccess) {
        try {
            const guild = member.guild;
            const adminCommands = ['bochi', '频道设置', '频道统计']; // 管理员命令列表
            
            // 为了简化实现，我们使用内部权限系统而不是Discord API权限
            // 这样可以避免复杂的权限API调用，同时保持功能完整性
            
            if (hasAdminAccess) {
                // 添加到内部管理员列表（如果需要）
                if (!this.config.botSettings.allowedRoles.includes(member.id)) {
                    this.config.botSettings.allowedRoles.push(member.id);
                }
                console.log(`✅ 已授予 ${member.user.username} 管理员命令访问权限`);
            } else {
                // 从内部管理员列表移除
                const index = this.config.botSettings.allowedRoles.indexOf(member.id);
                if (index > -1) {
                    this.config.botSettings.allowedRoles.splice(index, 1);
                }
                console.log(`❌ 已撤销 ${member.user.username} 的管理员命令访问权限`);
            }
            
            // 发送通知消息给用户（可选）
            try {
                const embed = new EmbedBuilder()
                    .setColor(hasAdminAccess ? '#00FF00' : '#FF0000')
                    .setTitle('🔑 权限变更通知')
                    .setDescription(hasAdminAccess ? 
                        '您已获得波奇机器人的管理员权限！现在可以使用 `/bochi` 等管理命令。' :
                        '您的波奇机器人管理员权限已被撤销。')
                    .setTimestamp();
                
                await member.send({ embeds: [embed] });
            } catch (dmError) {
                // 如果无法发送私信，静默处理
            }
            
        } catch (error) {
            console.error('更新用户命令权限时出错:', error.message);
        }
    }

    // 初始化服务器的权限同步
    async initializePermissions(guild) {
        try {
            const maintainerRole = guild.roles.cache.find(role => role.name === 'BOT维护员');
            if (!maintainerRole) return;
            
            // 同步所有拥有BOT维护员角色的用户
            maintainerRole.members.forEach(member => {
                if (!this.config.botSettings.allowedRoles.includes(member.id)) {
                    this.config.botSettings.allowedRoles.push(member.id);
                }
            });
            
            console.log(`🔄 已同步 ${guild.name} 的权限设置，BOT维护员数量: ${maintainerRole.members.size}`);
        } catch (error) {
            console.error('初始化权限时出错:', error.message);
        }
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

        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: '❌ 无法获取服务器信息。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const serverConfig = this.getServerConfig(guild.id);
        const beforeCount = serverConfig.serverEmojisCache.length;
        serverConfig.serverEmojisCache = [];
        serverConfig.customEmojis = [];
        serverConfig.selectedServerEmojis = [];
        serverConfig.tempSelectedEmojis = [];
        serverConfig.emojiPageIndex = 0;
        
        await interaction.reply({
            content: `✅ 已清空本服务器的 ${beforeCount} 个缓存表情，表情缓存已重置！下次使用时会重新扫描。`,
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
        // 管理员专用命令（只有具有"管理服务器"权限的用户可以看到和使用）
        const adminCommands = [
            {
                name: 'bochi',
                description: '打开波奇机器人配置面板',
                default_member_permissions: PermissionFlagsBits.ManageGuild.toString()
            },
            {
                name: '频道设置',
                description: '设置当前频道的波奇机器人配置',
                default_member_permissions: PermissionFlagsBits.ManageGuild.toString()
            },
            {
                name: '频道统计',
                description: '查看所有频道的反应统计信息',
                default_member_permissions: PermissionFlagsBits.ManageGuild.toString()
            }
        ];
        
        // 普通用户可用命令（所有人都可以看到，但只能在指定频道使用）
        const userCommands = [
            {
                name: '限制bochi对我做出反应',
                description: '阻止波奇机器人对您的图片做出反应'
            },
            {
                name: '允许bochi对我做出反应',
                description: '允许波奇机器人对您的图片做出反应'
            }
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        try {
            console.log('开始注册斜杠命令...');
            
            // 先清除所有现有的全局命令以避免重复
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: [] }
            );
            console.log('🧹 已清除所有全局命令');
            
            // 等待片刻让API处理完成
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // 只在所有服务器中注册命令（避免全局命令重复）
            const guilds = this.client.guilds.cache;
            console.log(`🔄 在 ${guilds.size} 个服务器中注册命令...`);
            
            for (const [guildId, guild] of guilds) {
                try {
                    // 先清除该服务器的现有命令
                    await rest.put(
                        Routes.applicationGuildCommands(this.client.user.id, guildId),
                        { body: [] }
                    );
                    
                    // 等待片刻
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // 注册所有命令
                    await rest.put(
                        Routes.applicationGuildCommands(this.client.user.id, guildId),
                        { body: [...adminCommands, ...userCommands] }
                    );
                    console.log(`✅ 在服务器 "${guild.name}" 中注册成功 (管理命令: ${adminCommands.length}, 用户命令: ${userCommands.length})`);
                } catch (guildError) {
                    console.error(`⚠️  在服务器 "${guild.name}" 中注册失败:`, guildError.message);
                }
            }
            
            console.log('✅ 所有服务器的斜杠命令注册完成！');
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