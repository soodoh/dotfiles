return {
  {
    "ravitemer/mcphub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    build = "npm install -g mcp-hub@latest", -- Installs `mcp-hub` node binary globally
    config = function()
      require("mcphub").setup({
        extensions = {
          avante = {
            make_slash_commands = true, -- make /slash commands from MCP server prompts
          },
        },
      })
    end,
  },
  {
    "yetone/avante.nvim",
    event = "VeryLazy",
    version = false, -- Never set this value to "*"! Never!
    opts = {
      provider = "claude",
      auto_suggestions_provider = "claude",
      providers = {
        copilot = {
          model = "claude-3.5-sonnet",
        },
        claude = {
          endpoint = "https://api.anthropic.com",
          model = "claude-3-5-sonnet-latest",
          extra_request_body = {
            temperature = 0.75,
            max_tokens = 4096,
          },
        },
      },
      mappings = {
        --- @class AvanteConflictMappings
        diff = {
          ours = "co",
          theirs = "ct",
          all_theirs = "ca",
          both = "cb",
          cursor = "cc",
          next = ",x",
          prev = ",,x",
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
          add_file = "@",
          close = { "<Esc>", "q" },
          close_from_input = nil, -- e.g., { normal = "<Esc>", insert = "<C-d>" }
        },
      },
      hints = { enabled = true },
      windows = {
        ---@type "right" | "left" | "top" | "bottom"
        position = "right", -- the position of the sidebar
        wrap = true, -- similar to vim.o.wrap
        width = 30, -- default % based on available width
        sidebar_header = {
          enabled = false, -- true, false to enable/disable the header
          align = "center", -- left, center, right for title
          rounded = true,
        },
        input = {
          prefix = "> ",
          height = 8, -- Height of the input window in vertical layout
        },
        edit = {
          border = "rounded",
          start_insert = false, -- Start insert mode when opening the edit window
        },
        ask = {
          floating = false, -- Open the 'AvanteAsk' prompt in a floating window
          start_insert = false, -- Start insert mode when opening the ask window
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
    },
    build = "make",
    config = function()
      require("avante").setup({
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
    end,
    dependencies = {
      "nvim-treesitter/nvim-treesitter",
      "nvim-lua/plenary.nvim",
      "MunifTanjim/nui.nvim",
      --- The below dependencies are optional,
      "nvim-telescope/telescope.nvim", -- for file_selector provider telescope
      "hrsh7th/nvim-cmp", -- autocompletion for avante commands and mentions
      "ibhagwan/fzf-lua", -- for file_selector provider fzf
      "zbirenbaum/copilot.lua", -- for providers='copilot'
      "folke/snacks.nvim", -- for input provider snacks
      {
        -- support for image pasting
        "HakonHarnes/img-clip.nvim",
        event = "VeryLazy",
        opts = {
          input = {
            provider = "snacks",
            provider_opts = {
              -- Additional snacks.input options
              title = "Avante Input",
              icon = " ",
            },
          },
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
