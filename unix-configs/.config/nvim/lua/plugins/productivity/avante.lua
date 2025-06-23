return {
  {
    "ravitemer/mcphub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    build = "npm install -g mcp-hub@latest", -- Installs `mcp-hub` node binary globally
    config = function()
      require("mcphub").setup({
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
            model = "claude-3.7-sonnet-thought",
            timeout = 45000, -- Timeout in milliseconds, increase this for reasoning models
            extra_request_body = {
              temperature = 0.75,
              max_tokens = 8192, -- Increase this to include reasoning tokens (for reasoning models)
            },
          },
          -- claude = {
          --   endpoint = "https://api.anthropic.com",
          --   model = "claude-sonnet-4-20250514",
          --   timeout = 45000, -- Timeout in milliseconds, increase this for reasoning models
          --   extra_request_body = {
          --     temperature = 0.75,
          --     max_tokens = 8192, -- Increase this to include reasoning tokens (for reasoning models)
          --   },
          -- },
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
            next = ",x",
            prev = ",,x",
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
      "echasnovski/mini.pick", -- for file_selector provider mini.pick
      "nvim-telescope/telescope.nvim", -- for file_selector provider telescope
      "hrsh7th/nvim-cmp", -- autocompletion for avante commands and mentions
      "ibhagwan/fzf-lua", -- for file_selector provider fzf
      "folke/snacks.nvim", -- for input provider snacks
      "nvim-tree/nvim-web-devicons", -- or echasnovski/mini.icons
      "zbirenbaum/copilot.lua", -- for providers='copilot'
      {
        -- support for image pasting
        "HakonHarnes/img-clip.nvim",
        event = "VeryLazy",
        opts = {
          -- recommended settings
          default = {
            embed_image_as_base64 = false,
            prompt_for_file_name = false,
            drag_and_drop = {
              insert_mode = true,
            },
            -- required for Windows users
            use_absolute_path = true,
          },
        },
      },
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
