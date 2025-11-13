return {
  {
    "ravitemer/mcphub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    build = "bundled_build.lua", -- Bundles `mcp-hub` binary along with the neovim plugin
    config = function()
      require("mcphub").setup({
        use_bundled_binary = true,
        config = vim.fn.expand("~/.config/mcphub/servers.json"),
      })

      require("which-key").add({
        {
          "<leader>am",
          ":MCPHub<CR>",
          desc = "MCP Hub",
        },
      })
    end,
  },
  {
    "yetone/avante.nvim",
    event = "VeryLazy",
    version = false, -- Never set this value to "*"! Never!
    config = function()
      require("avante").setup({
        provider = "copilot",
        auto_suggestions_provider = "copilot",
        mode = "agentic",
        providers = {
          copilot = {
            model = "claude-4.5-sonnet",
            -- model = "gpt-4o",
            timeout = 60000, -- Timeout in milliseconds, increase this for reasoning models
            extra_request_body = {
              temperature = 0.75,
              max_tokens = 8192, -- Increase this to include reasoning tokens (for reasoning models)
            },
          },
          claude = {
            endpoint = "https://api.anthropic.com",
            model = "claude-3-7-sonnet-latest",
            timeout = 60000, -- Timeout in milliseconds, increase this for reasoning models
            extra_request_body = {
              temperature = 0.75,
              max_tokens = 8192, -- Increase this to include reasoning tokens (for reasoning models)
            },
          },
        },
        -- rag_service = {
        --   enabled = true,
        --   host_mount = os.getenv("HOME"),
        --   runner = "docker",
        --   llm = {
        --     provider = "copilot",
        --     model = "gpt-4o",
        --     extra = nil, -- Additional configuration options for LLM
        --   },
        --   embed = {
        --     provider = "copilot",
        --     model = "text-embedding-3-large",
        --     extra = nil, -- Additional configuration options for the embedding model
        --   },
        --   docker_extra_args = "", -- Extra arguments to pass to the docker command
        -- },
        windows = {
          position = "right",
          edit = { start_insert = false },
          ask = { start_insert = false },
        },
        behaviour = {
          auto_suggestions = false,
          auto_set_highlight_group = true,
          auto_set_keymaps = true,
          auto_apply_diff_after_generation = false,
          support_paste_from_clipboard = false,
          minimize_diff = true, -- Whether to remove unchanged lines when applying a code block
          enable_token_counting = true, -- Whether to enable token counting. Default to true.
          auto_approve_tool_permissions = false, -- Default: show permission prompts for all tools
          -- Examples:
          -- auto_approve_tool_permissions = true,                -- Auto-approve all tools (no prompts)
          -- auto_approve_tool_permissions = {"bash", "replace_in_file"}, -- Auto-approve specific tools only
        },
        web_search_engine = {
          provider = "brave",
        },
        input = {
          provider = "snacks",
        },
        mappings = {
          --- @class AvanteConflictMappings
          diff = {
            next = "]x",
            prev = "[x",
          },
          jump = {
            next = "]]",
            prev = "[[",
          },
          submit = {
            normal = "<CR>",
            insert = "<C-s>",
          },
          cancel = {
            normal = { "<C-c>", "<Esc>", "q" },
            insert = { "<C-c>" },
          },
          sidebar = {
            close = { "<Esc>", "<C-c>", "q" },
            close_from_input = { normal = { "<Esc>", "<C-c>", "q" } },
          },
        },
        -- system_prompt as function ensures LLM always has latest MCP server state
        -- This is evaluated for every message, even in existing chats
        system_prompt = function()
          local hub = require("mcphub").get_hub_instance()
          return hub and hub:get_active_servers_prompt() or ""
        end,
        -- Using function prevents requiring mcphub before it's loaded
        custom_tools = function()
          return {
            require("mcphub.extensions.avante").mcp_tool(),
          }
        end,
      })

      require("which-key").add({
        {
          "<leader>a",
          group = "Avante",
        },
        {
          "<leader>al",
          ":AvanteClear<CR>",
          desc = "Clear Avante chat",
        },
      })
    end,
    -- if you want to build from source then do `make BUILD_FROM_SOURCE=true`
    build = "make",
    -- build = "powershell -ExecutionPolicy Bypass -File Build.ps1 -BuildFromSource false" -- for windows
    dependencies = {
      "nvim-treesitter/nvim-treesitter",
      "nvim-lua/plenary.nvim",
      "MunifTanjim/nui.nvim",
      --- The below dependencies are optional,
      "nvim-telescope/telescope.nvim", -- for file_selector provider telescope
      "folke/snacks.nvim", -- for input provider snacks
      "nvim-tree/nvim-web-devicons", -- or echasnovski/mini.icons
      "zbirenbaum/copilot.lua", -- for providers='copilot'
      "saghen/blink.cmp", -- Autocomplete
      {
        -- Make sure to set this up properly if you have lazy=true
        "MeanderingProgrammer/render-markdown.nvim",
        opts = {
          file_types = { "markdown", "Avante" },
        },
        ft = { "markdown", "Avante" },
      },
    },
  },
  -- Git conflict
  { "akinsho/git-conflict.nvim", version = "*", config = true },
}
