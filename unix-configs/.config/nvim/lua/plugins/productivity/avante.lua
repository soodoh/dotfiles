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
            extra_request_body = {
              timeout = 45000, -- Timeout in milliseconds, increase this for reasoning models
              temperature = 0.75,
              max_completion_tokens = 8192, -- Increase this to include reasoning tokens (for reasoning models)
              reasoning_effort = "medium", -- low|medium|high, only used for reasoning models
            },
          },
          -- claude = {
          --   endpoint = "https://api.anthropic.com",
          --   model = "claude-sonnet-4-20250514",
          --   extra_request_body = {
          --     timeout = 45000, -- Timeout in milliseconds, increase this for reasoning models
          --     temperature = 0.75,
          --     max_completion_tokens = 8192, -- Increase this to include reasoning tokens (for reasoning models)
          --     reasoning_effort = "medium", -- low|medium|high, only used for reasoning models
          --   },
          -- },
        },
        web_search_engine = {
          provider = "brave",
        },
        dual_boost = {
          enabled = false,
          first_provider = "openai",
          second_provider = "claude",
          prompt = "Based on the two reference outputs below, generate a response that incorporates elements from both but reflects your own judgment and unique perspective. Do not provide any explanation, just give the response directly. Reference Output 1: [{{provider1_output}}], Reference Output 2: [{{provider2_output}}]",
          timeout = 60000, -- Timeout in milliseconds
        },
        behaviour = {
          auto_suggestions = false, -- Experimental stage
          auto_set_highlight_group = false,
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
        input = {
          provider = "snacks",
        },
        mappings = {
          --- @class AvanteConflictMappings
          diff = {
            ours = "co",
            theirs = "ct",
            all_theirs = "ca",
            both = "cb",
            cursor = "cc",
            next = "]x",
            prev = "[x",
          },
          suggestion = {
            accept = "<M-l>",
            next = "<M-]>",
            prev = "<M-[>",
            dismiss = "<C-]>",
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
            apply_all = "A",
            apply_cursor = "a",
            retry_user_request = "r",
            edit_user_request = "e",
            switch_windows = "<Tab>",
            reverse_switch_windows = "<S-Tab>",
            remove_file = "d",
            -- add_file = "@",
            close = { "<Esc>", "<C-c>", "q" },
            close_from_input = { normal = { "<Esc>", "<C-c>", "q" } },
          },
        },
        hints = { enabled = true },
        windows = {
          ---@type "right" | "left" | "top" | "bottom"
          position = "right", -- the position of the sidebar
          wrap = true, -- similar to vim.o.wrap
          width = 30, -- default % based on available width
          sidebar_header = {
            enabled = true, -- true, false to enable/disable the header
            align = "center", -- left, center, right for title
            rounded = true,
          },
          input = {
            prefix = "> ",
            height = 8, -- Height of the input window in vertical layout
          },
          edit = {
            border = "rounded",
            start_insert = true, -- Start insert mode when opening the edit window
          },
          ask = {
            floating = false, -- Open the 'AvanteAsk' prompt in a floating window
            start_insert = true, -- Start insert mode when opening the ask window
            border = "rounded",
            ---@type "ours" | "theirs"
            focus_on_apply = "ours", -- which diff to focus after applying
          },
        },
        highlights = {
          diff = {
            current = "DiffText",
            incoming = "DiffAdd",
          },
        },
        --- @class AvanteConflictUserConfig
        diff = {
          autojump = true,
          ---@type string | fun(): any
          list_opener = "copen",
          --- Override the 'timeoutlen' setting while hovering over a diff (see :help timeoutlen).
          --- Helps to avoid entering operator-pending mode with diff mappings starting with `c`.
          --- Disable by setting to -1.
          override_timeoutlen = 500,
        },
        suggestion = {
          debounce = 600,
          throttle = 600,
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
        -- Add token usage optimization settings
        context = {
          max_tokens = 18000,
          include_buffer_content = false, -- Only include when explicitly needed
          trim_buffer_context = true, -- Trim unnecessary context
        },
        rate_limit = {
          enabled = true,
          tokens_per_minute = 20000, -- Match your limit
          cooldown_period = 60, -- seconds
        },
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
}
