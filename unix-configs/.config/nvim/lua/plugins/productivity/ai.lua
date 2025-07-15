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
  -- {
  --   "olimorris/codecompanion.nvim",
  --   config = function()
  --     require("codecompanion").setup({
  --       strategies = {
  --         chat = {
  --           adapter = "copilot",
  --         },
  --         inline = {
  --           adapter = "copilot",
  --         },
  --       },
  --       extensions = {
  --         mcphub = {
  --           callback = "mcphub.extensions.codecompanion",
  --           opts = {
  --             show_result_in_chat = true, -- Show mcp tool results in chat
  --             make_vars = true, -- Convert resources to #variables
  --             make_slash_commands = true, -- Add prompts as /slash commands
  --           },
  --         },
  --       },
  --     })
  --   end,
  --   dependencies = {
  --     "nvim-lua/plenary.nvim",
  --     "nvim-treesitter/nvim-treesitter",
  --   },
  -- },
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
            -- model = "claude-3.7-sonnet",
            model = "gpt-4o",
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
        dual_boost = {
          enabled = false,
          first_provider = "copilot",
          second_provider = "claude",
          prompt = "Based on the two reference outputs below, generate a response that incorporates elements from both but reflects your own judgment and unique perspective. Do not provide any explanation, just give the response directly. Reference Output 1: [{{provider1_output}}], Reference Output 2: [{{provider2_output}}]",
          timeout = 60000, -- Timeout in milliseconds
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
