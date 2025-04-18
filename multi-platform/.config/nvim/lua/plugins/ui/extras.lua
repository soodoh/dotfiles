return {
  -- Color theme
  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    config = function()
      require("catppuccin").setup({
        color_overrides = {
          mocha = {
            base = "#000000",
            mantle = "#000000",
            crust = "#000000",
          },
        },
        integrations = {
          bufferline = true,
          fzf = true,
          gitsigns = true,
          hop = true,
          indent_blankline = {
            enabled = true,
            scope_color = "", -- catppuccin color (eg. `lavender`) Default: text
            colored_indent_levels = false,
          },
          lsp_saga = true,
          mason = true,
          neogit = true,
          nvim_surround = true,
          nvimtree = true,
          treesitter_context = true,
          treesitter = true,
          ts_rainbow = true,
          ufo = true,
          telescope = {
            enabled = true,
            -- style = "nvchad"
          },
          lsp_trouble = true,
          which_key = true,
        },
      })
      vim.cmd.colorscheme("catppuccin-mocha")
    end,
  },

  -- Smooth scrolling
  {
    "karb94/neoscroll.nvim",
    opts = {
      hide_cursor = true,
      respect_scrolloff = true,
      cursor_scrolls_alone = true,
      performance_mode = true,
    },
  },

  -- Status Line
  {
    "nvim-lualine/lualine.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      require("lualine").setup({
        options = {
          theme = "catppuccin",
        },
      })
    end,
  },

  -- Color hex codes
  {
    "norcalli/nvim-colorizer.lua",
    opts = {
      "*",
      css = { css = true },
    },
  },

  -- Minimap
  {
    "Isrothy/neominimap.nvim",
    version = "v3.x.x",
    lazy = false, -- NOTE: NO NEED to Lazy load
    -- Optional. You can alse set your own keybindings
    keys = {
      -- Global Minimap Controls
      {
        "<leader>mm",
        "<cmd>Neominimap toggle on<cr>",
        desc = "Toggle global minimap",
      },
      {
        "<leader>mr",
        "<cmd>Neominimap refresh<cr>",
        desc = "Refresh global minimap",
      },
      {
        "<leader>ms",
        "<cmd>Neominimap toggleFocus<cr>",
        desc = "Switch focus on minimap",
      },
    },
    init = function()
      require("which-key").add({
        { "<leader>m", group = "Minimap" },
      })

      -- The following options are recommended when layout == "float"
      vim.opt.wrap = false
      vim.opt.sidescrolloff = 36 -- Set a large value

      --- Put your configuration here
      vim.g.neominimap = {
        auto_enable = true,
      }
    end,
  },
}
