# 波奇Discord机器人 (Bochi Discord Bot)

## Overview

波奇是一个专为图片识别和AI点评设计的Discord机器人。该机器人集成了AI服务，能够自动对用户分享的图片进行反应和智能点评，特别专注于Discord服务器中的图片分析和互动功能。

## 功能特点

- **智能图片识别**: 自动检测频道中的图片并进行处理
- **AI点评系统**: 使用Gemini或OpenAI API对图片进行友好的点评
- **自动表情反应**: 对精美图片自动添加表情反应
- **权限控制**: 支持基于Discord角色的权限管理
- **多API支持**: 同时支持Gemini和OpenAI API，支持多密钥轮询
- **模型选择**: 支持动态获取和选择不同的AI模型
- **Discord原生交互**: 使用Discord的按钮、选择菜单、模态框等原生组件进行配置

## 机器人设置指南

### 1. Discord开发者门户设置

1. 访问 https://discord.com/developers/applications
2. 创建新应用或选择现有应用
3. 在"Bot"页面中：
   - 启用"MESSAGE CONTENT INTENT"
   - 启用"SERVER MEMBERS INTENT"（可选）
4. 复制Bot Token并在Replit中设置为DISCORD_TOKEN密钥
5. 在"OAuth2 > URL Generator"中：
   - 选择"bot"和"applications.commands"作用域
   - 选择必要的权限：
     - Send Messages
     - Use Slash Commands
     - Add Reactions
     - Attach Files
     - Read Message History
   - 使用生成的URL邀请机器人到服务器

### 2. 机器人权限配置

机器人控制权限通过"/波奇面板"命令中的"权限设置"进行配置：
- 只有拥有指定角色的用户才能使用机器人配置功能
- 默认情况下，如果未设置任何角色，所有用户都可以使用
- 支持多角色权限控制

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Application Structure
- **Single-file architecture**: The main application logic is contained in `index.js`, following a class-based design pattern with the `BochiBot` class as the central controller
- **Event-driven architecture**: Built on Discord.js event system to handle user interactions, message events, and bot commands
- **Configuration-driven design**: Centralized configuration object managing bot settings, API configurations, and user permissions

### Bot Framework
- **Discord.js v14**: Primary framework for Discord API integration
- **Gateway Intents**: Configured with minimal required permissions (Guilds intent)
- **Slash Commands**: Uses Discord's modern slash command system for user interactions
- **Interactive Components**: Implements buttons, select menus, and modals for rich user experiences

### AI Integration Layer
- **Multi-provider support**: Dual AI provider architecture supporting both Google Gemini and OpenAI
- **Fallback mechanism**: Primary Gemini integration with OpenAI as alternative option
- **API key rotation**: Built-in support for multiple Gemini API keys with automatic rotation
- **Model flexibility**: Configurable model selection (gemini-1.5-flash, gpt-4-vision-preview)

### Permission System
- **Role-based access control**: Configurable allowed roles for bot administration
- **Permission validation**: Built-in permission checking for sensitive operations
- **Security-first approach**: Ephemeral responses for unauthorized access attempts

### Configuration Management
- **Runtime configuration**: Dynamic settings that can be modified through bot interface
- **Persistent state**: Configuration maintained in memory during bot runtime
- **Hierarchical settings**: Separate configuration domains for bot behavior and API settings

## External Dependencies

### AI Services
- **Google Generative AI**: Primary AI provider using `@google/generative-ai` package for image analysis and text generation
- **OpenAI API**: Secondary AI provider accessed via HTTP requests using axios
- **Model Support**: Gemini 1.5 Flash and GPT-4 Vision Preview for multimodal capabilities

### Discord Platform
- **Discord.js**: Complete Discord API wrapper providing bot functionality, event handling, and rich message components
- **Discord API**: Real-time gateway connection for live message processing and user interactions

### HTTP Client
- **Axios**: HTTP client library for external API communications, particularly for OpenAI integration and potential webhook support

### Environment Management
- **dotenv**: Environment variable management for secure API key storage and configuration

### Runtime Dependencies
- **Node.js**: JavaScript runtime environment
- **NPM ecosystem**: Standard package management and dependency resolution